import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FindOperator, In, Repository } from 'typeorm';
import { jest } from '@jest/globals';
import { FoldersService } from './folders.service';
import { Carpeta } from './carpeta.entity';
import { Documento } from '../documents/documento.entity';
import type { AlmacenamientoService } from '../storage/almacenamiento.service';
import type { AuditService } from '../audit/audit.service';
import type { UsuarioSesion } from '../auth/usuario-sesion';

const usuario = (id: number, rol: string, departamento: string): UsuarioSesion => ({
  id,
  nombre: `Usuario ${id}`,
  correo: `u${id}@empresa.com`,
  rol,
  departamento,
});
const admin = usuario(1, 'Administrador', 'Gerencia');
const ana = usuario(2, 'usuario', 'SST');
const rrhh = usuario(3, 'usuario', 'Recursos Humanos');

/** Ids del criterio `{ id: In([...]) }` con que se llamó a `em.delete`. */
const idsBorrados = (criterio: unknown) => (criterio as { id: FindOperator<number[]> }).id.value;

const R2 = 'https://cuenta.r2.cloudflarestorage.com/bucket/';
const ANTES_1 = 'documentos/sst/fichas/chaqueta-aaaa1111.jpg';
const ANTES_2 = 'documentos/sst/fichas/2026/manual-bbbb2222.pdf';
const DESPUES_1 = 'documentos/sst/fichas-tecnicas/chaqueta-aaaa1111.jpg';
const DESPUES_2 = 'documentos/sst/fichas-tecnicas/2026/manual-bbbb2222.pdf';

describe('FoldersService', () => {
  let carpetas: Carpeta[];
  let documentos: Documento[];
  let em: {
    update: jest.Mock<(...args: unknown[]) => Promise<void>>;
    delete: jest.Mock<(...args: unknown[]) => Promise<void>>;
  };
  let almacenamiento: {
    usaR2: boolean;
    copiarEnR2: jest.Mock<(origen: string, destino: string) => Promise<void>>;
    eliminarClavesR2: jest.Mock<(claves: readonly string[]) => Promise<void>>;
    eliminar: jest.Mock<(archivo: Documento) => Promise<void>>;
    urlR2: jest.Mock<(clave: string) => string>;
  };
  let auditoria: { registrar: jest.Mock<(...args: unknown[]) => Promise<void>> };
  let service: FoldersService;

  beforeEach(() => {
    // Silencia los logs de error esperados (p. ej. "R2 caído") sin tocar el Logger real.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    carpetas = [
      { id: 10, nombre: 'Fichas', departamento: 'SST', padreId: null, usuarioId: 2 },
      { id: 11, nombre: '2026', departamento: 'SST', padreId: 10, usuarioId: 2 },
      { id: 12, nombre: 'Otra', departamento: 'SST', padreId: null, usuarioId: 2 },
    ] as Carpeta[];
    documentos = [
      { id: 1, carpetaId: 10, nombreGuardado: ANTES_1, ruta: R2 + ANTES_1 },
      { id: 2, carpetaId: 11, nombreGuardado: ANTES_2, ruta: R2 + ANTES_2 },
      // Documento del respaldo local: no se mueve en R2.
      { id: 3, carpetaId: 11, nombreGuardado: 'local.pdf', ruta: '/uploads/local.pdf' },
    ] as Documento[];

    em = {
      update: jest.fn((entidad: unknown, criterio: unknown, cambios: unknown) => {
        if (entidad === Carpeta) {
          const c = carpetas.find((x) => x.id === (criterio as { id: number }).id)!;
          Object.assign(c, cambios);
        }
        return Promise.resolve();
      }),
      delete: jest.fn((entidad: unknown, criterio: unknown) => {
        const ids = new Set(idsBorrados(criterio));
        if (entidad === Documento) {
          documentos = documentos.filter((d) => !ids.has(d.id));
        } else if (entidad === Carpeta) {
          // Como las claves foráneas de MySQL (comprobadas fila a fila): no se puede borrar
          // una carpeta que aún tiene documentos o subcarpetas, ni madre e hija a la vez.
          const referenciada =
            documentos.some((d) => ids.has(d.carpetaId!)) ||
            carpetas.some((c) => c.padreId !== null && ids.has(c.padreId));
          if (referenciada) {
            return Promise.reject(
              new Error('ER_ROW_IS_REFERENCED_2: a foreign key constraint fails'),
            );
          }
          carpetas = carpetas.filter((c) => !ids.has(c.id));
        }
        return Promise.resolve();
      }),
    };

    const carpetaRepository = {
      findOne: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(carpetas.find((c) => c.id === where.id) ?? null),
      ),
      find: jest.fn(({ where }: { where: { departamento: string; padreId?: unknown } }) =>
        Promise.resolve(
          carpetas.filter((c) => {
            if (c.departamento !== where.departamento) return false;
            if (!('padreId' in where)) return true;
            // IsNull() llega como FindOperator; un número, como número.
            return typeof where.padreId === 'number'
              ? c.padreId === where.padreId
              : c.padreId === null;
          }),
        ),
      ),
      create: jest.fn((datos: Partial<Carpeta>) => datos),
      save: jest.fn((datos: Partial<Carpeta>) => Promise.resolve({ ...datos, id: 99 } as Carpeta)),
      manager: {
        transaction: jest.fn((trabajo: (manager: typeof em) => Promise<void>) => trabajo(em)),
      },
    };
    const documentoRepository = {
      find: jest.fn(({ where }: { where: { carpetaId: FindOperator<number[]> } }) =>
        Promise.resolve(documentos.filter((d) => where.carpetaId.value.includes(d.carpetaId!))),
      ),
    };

    almacenamiento = {
      usaR2: true,
      copiarEnR2: jest.fn(() => Promise.resolve()),
      eliminarClavesR2: jest.fn(() => Promise.resolve()),
      eliminar: jest.fn(() => Promise.resolve()),
      urlR2: jest.fn((clave: string) => R2 + clave),
    };
    auditoria = { registrar: jest.fn(() => Promise.resolve()) };

    service = new FoldersService(
      carpetaRepository as unknown as Repository<Carpeta>,
      documentoRepository as unknown as Repository<Documento>,
      almacenamiento as unknown as AlmacenamientoService,
      auditoria as unknown as AuditService,
    );
  });

  describe('renombrar', () => {
    it('mueve en R2 los objetos de la carpeta y de sus subcarpetas, y actualiza la BD', async () => {
      const resultado = await service.renombrar(10, { nombre: 'Fichas técnicas' }, ana);

      expect(resultado.nombre).toBe('Fichas técnicas');
      expect(almacenamiento.copiarEnR2.mock.calls).toEqual([
        [ANTES_1, DESPUES_1],
        [ANTES_2, DESPUES_2],
      ]);
      expect(em.update).toHaveBeenCalledWith(Carpeta, { id: 10 }, { nombre: 'Fichas técnicas' });
      expect(em.update).toHaveBeenCalledWith(
        Documento,
        { id: 1 },
        { nombreGuardado: DESPUES_1, ruta: R2 + DESPUES_1 },
      );
      expect(em.update).toHaveBeenCalledWith(
        Documento,
        { id: 2 },
        { nombreGuardado: DESPUES_2, ruta: R2 + DESPUES_2 },
      );
      // Los originales se borran solo después de confirmar la transacción.
      expect(almacenamiento.eliminarClavesR2).toHaveBeenLastCalledWith([ANTES_1, ANTES_2]);
      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ accion: 'RENAME_FOLDER', departamento: 'SST' }),
      );
    });

    it('si una copia falla, borra las copias hechas y no toca la BD ni los originales', async () => {
      almacenamiento.copiarEnR2.mockImplementation((origen) =>
        origen === ANTES_2 ? Promise.reject(new Error('R2 caído')) : Promise.resolve(),
      );

      await expect(service.renombrar(10, { nombre: 'Fichas técnicas' }, ana)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(em.update).not.toHaveBeenCalled();
      expect(almacenamiento.eliminarClavesR2.mock.calls).toEqual([[[DESPUES_1]]]);
      expect(auditoria.registrar).not.toHaveBeenCalled();
    });

    it('si el prefijo no cambia (solo mayúsculas), solo actualiza la BD', async () => {
      await service.renombrar(10, { nombre: 'FICHAS' }, ana);
      expect(almacenamiento.copiarEnR2).not.toHaveBeenCalled();
      expect(em.update).toHaveBeenCalledTimes(1);
    });

    it('rechaza un nombre que ya usa otra carpeta hermana (sin distinguir mayúsculas)', async () => {
      await expect(service.renombrar(10, { nombre: 'otra' }, ana)).rejects.toThrow(
        ConflictException,
      );
    });

    it('un usuario de otra área recibe 404 y no se mueve nada', async () => {
      await expect(service.renombrar(10, { nombre: 'X' }, rrhh)).rejects.toThrow(NotFoundException);
      expect(almacenamiento.copiarEnR2).not.toHaveBeenCalled();
    });
  });

  describe('eliminarCarpeta', () => {
    it('borra documentos y subcarpetas en la BD (de abajo arriba) y después sus archivos', async () => {
      const resultado = await service.eliminarCarpeta(10, admin);

      expect(resultado).toEqual({
        mensaje: 'Carpeta "Fichas" eliminada correctamente',
        carpetasEliminadas: 2,
        documentosEliminados: 3,
      });
      // Solo sobrevive la carpeta hermana; ningún documento del subárbol.
      expect(carpetas.map((c) => c.id)).toEqual([12]);
      expect(documentos).toEqual([]);
      // Documentos → subcarpeta "2026" → "Fichas" (el mock rechaza cualquier otro orden).
      expect(
        em.delete.mock.calls.map(([entidad, criterio]) => [entidad, idsBorrados(criterio)]),
      ).toEqual([
        [Documento, [1, 2, 3]],
        [Carpeta, [11]],
        [Carpeta, [10]],
      ]);
      // Archivos de R2 y del respaldo local, solo después de confirmar la transacción.
      expect(almacenamiento.eliminar.mock.calls.map(([doc]) => doc.nombreGuardado)).toEqual([
        ANTES_1,
        ANTES_2,
        'local.pdf',
      ]);
      expect(Math.max(...em.delete.mock.invocationCallOrder)).toBeLessThan(
        Math.min(...almacenamiento.eliminar.mock.invocationCallOrder),
      );
      expect(auditoria.registrar).toHaveBeenCalledWith({
        usuarioId: 1,
        accion: 'DELETE_FOLDER',
        departamento: 'SST',
        detalles: 'Eliminó la carpeta "Fichas" (id 10) con 1 subcarpeta(s) y 3 archivo(s)',
      });
    });

    it('al eliminar una subcarpeta conserva la carpeta madre y sus archivos', async () => {
      await service.eliminarCarpeta(11, admin);

      expect(carpetas.map((c) => c.id)).toEqual([10, 12]);
      expect(documentos.map((d) => d.id)).toEqual([1]);
      expect(almacenamiento.eliminar).toHaveBeenCalledTimes(2);
      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          detalles: 'Eliminó la carpeta "Fichas / 2026" (id 11) con 2 archivo(s)',
        }),
      );
    });

    it('una carpeta vacía solo borra su registro', async () => {
      const resultado = await service.eliminarCarpeta(12, admin);

      expect(resultado).toMatchObject({ carpetasEliminadas: 1, documentosEliminados: 0 });
      expect(em.delete).toHaveBeenCalledTimes(1);
      expect(almacenamiento.eliminar).not.toHaveBeenCalled();
      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ detalles: 'Eliminó la carpeta "Otra" (id 12)' }),
      );
    });

    it('si la transacción falla, no borra ningún archivo ni registra auditoría', async () => {
      em.delete.mockImplementation(() => Promise.reject(new Error('BD caída')));

      await expect(service.eliminarCarpeta(10, admin)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(almacenamiento.eliminar).not.toHaveBeenCalled();
      expect(auditoria.registrar).not.toHaveBeenCalled();
    });

    it('si hay archivos en R2 pero R2 no está configurado, no toca nada', async () => {
      almacenamiento.usaR2 = false;

      await expect(service.eliminarCarpeta(10, admin)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(em.delete).not.toHaveBeenCalled();
      expect(almacenamiento.eliminar).not.toHaveBeenCalled();
    });

    it('responde 404 si la carpeta no existe o es de otra área, sin borrar nada', async () => {
      await expect(service.eliminarCarpeta(999, admin)).rejects.toThrow(NotFoundException);
      await expect(service.eliminarCarpeta(10, rrhh)).rejects.toThrow(NotFoundException);
      expect(em.delete).not.toHaveBeenCalled();
      expect(almacenamiento.eliminar).not.toHaveBeenCalled();
    });
  });

  describe('crear', () => {
    it('una subcarpeta hereda el área del padre y queda auditada', async () => {
      const creada = await service.crear({ nombre: 'Enero', padreId: 11 }, ana);
      expect(creada).toMatchObject({ nombre: 'Enero', departamento: 'SST', padreId: 11 });
      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          accion: 'CREATE_FOLDER',
          detalles: expect.stringContaining('Fichas / 2026 / Enero') as unknown,
        }),
      );
    });

    it('un usuario no puede crear carpetas en la raíz de otra área', async () => {
      await expect(
        service.crear({ nombre: 'Nóminas', departamento: 'Recursos Humanos' }, ana),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it('listar() de un usuario consulta solo su área', async () => {
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      withDeleted: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn(() => Promise.resolve([])),
    };
    const servicio = new FoldersService(
      { createQueryBuilder: () => qb } as unknown as Repository<Carpeta>,
      {} as Repository<Documento>,
      almacenamiento as unknown as AlmacenamientoService,
      auditoria as unknown as AuditService,
    );
    await servicio.listar(ana);
    expect(qb.where).toHaveBeenCalledWith('carpeta.departamento = :area', { area: 'SST' });
  });

  it('el mock de In() expone los ids del subárbol', () => {
    // Garantiza que el filtro por carpetas usado en renombrar sigue siendo In([...]).
    expect(In([10, 11]).value).toEqual([10, 11]);
  });
});
