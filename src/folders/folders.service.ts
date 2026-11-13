import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import {
  departamentoParaEscritura,
  departamentoParaLectura,
  mismoDepartamento,
  puedeAcceder,
  type UsuarioSesion,
} from '../auth/usuario-sesion';
import { enParalelo } from '../common/en-paralelo';
import { type Departamento } from '../common/departamentos';
import { normalizarTexto } from '../common/texto';
import { Documento } from '../documents/documento.entity';
import { AlmacenamientoService, estaEnR2 } from '../storage/almacenamiento.service';
import { reubicarClave } from '../storage/claves';
import { Carpeta } from './carpeta.entity';
import type { CrearCarpetaDto } from './dto/crear-carpeta.dto';
import type { RenombrarCarpetaDto } from './dto/renombrar-carpeta.dto';
import { PROFUNDIDAD_MAXIMA_CARPETAS, validarNombreCarpeta } from './nombre-carpeta';

/** Dónde se guarda algo: un área y, opcionalmente, una carpeta dentro de ella. */
export interface DestinoSubida {
  departamento: Departamento;
  carpeta: Carpeta | null;
  /** Nombres de las carpetas desde la raíz del área hasta `carpeta` (vacío = raíz). */
  segmentos: string[];
}

export interface CarpetaSerializada {
  id: number;
  nombre: string;
  departamento: Departamento;
  padreId: number | null;
  usuarioId: number;
  creadoPor: string;
  fechaCreacion: Date;
  fechaActualizacion: Date;
}

/** Copias simultáneas en R2 al renombrar. */
const CONCURRENCIA_COPIAS = 4;

function serializarCarpeta(carpeta: Carpeta, creadoPor?: string): CarpetaSerializada {
  return {
    id: carpeta.id,
    nombre: carpeta.nombre,
    departamento: carpeta.departamento,
    padreId: carpeta.padreId ?? null,
    usuarioId: carpeta.usuarioId,
    creadoPor: creadoPor ?? carpeta.usuario?.nombre ?? `Usuario #${carpeta.usuarioId}`,
    fechaCreacion: carpeta.fechaCreacion,
    fechaActualizacion: carpeta.fechaActualizacion,
  };
}

/** Ids de la carpeta `raizId` y de todas sus subcarpetas (a cualquier profundidad). */
function idsSubarbol(raizId: number, carpetas: readonly Carpeta[]): number[] {
  const hijas = new Map<number, number[]>();
  for (const c of carpetas) {
    if (c.padreId === null) continue;
    hijas.set(c.padreId, [...(hijas.get(c.padreId) ?? []), c.id]);
  }
  const resultado = new Set<number>([raizId]);
  const pendientes = [raizId];
  while (pendientes.length > 0) {
    for (const hija of hijas.get(pendientes.pop()!) ?? []) {
      if (!resultado.has(hija)) {
        resultado.add(hija);
        pendientes.push(hija);
      }
    }
  }
  return [...resultado];
}

/** Nombres desde la raíz del área hasta `id` usando un mapa en memoria. */
function nombresDesdeRaiz(id: number, porId: ReadonlyMap<number, Carpeta>): string[] {
  const nombres: string[] = [];
  let actual = porId.get(id);
  while (actual) {
    if (nombres.length > PROFUNDIDAD_MAXIMA_CARPETAS) {
      throw new InternalServerErrorException('La jerarquía de carpetas tiene un ciclo.');
    }
    nombres.unshift(actual.nombre);
    actual = actual.padreId === null ? undefined : porId.get(actual.padreId);
  }
  return nombres;
}

@Injectable()
export class FoldersService {
  private readonly logger = new Logger(FoldersService.name);

  constructor(
    @InjectRepository(Carpeta)
    private readonly carpetaRepository: Repository<Carpeta>,
    @InjectRepository(Documento)
    private readonly documentoRepository: Repository<Documento>,
    private readonly almacenamiento: AlmacenamientoService,
    private readonly auditoria: AuditService,
  ) {}

  /* ---------------------------- Consultas ---------------------------- */

  /**
   * Carpetas visibles para el usuario (lista plana con `padreId`; el frontend arma el árbol).
   * Administrador: todas, o las del área indicada. Resto: solo las de su área.
   */
  async listar(usuario: UsuarioSesion, departamento?: string): Promise<CarpetaSerializada[]> {
    const area = departamentoParaLectura(usuario, departamento);

    const qb = this.carpetaRepository
      .createQueryBuilder('carpeta')
      .leftJoin('carpeta.usuario', 'usuario')
      .addSelect(['usuario.id', 'usuario.nombre'])
      .orderBy('carpeta.departamento', 'ASC')
      .addOrderBy('carpeta.nombre', 'ASC');

    if (area) {
      qb.where('carpeta.departamento = :area', { area });
    }

    return (await qb.getMany()).map((c) => serializarCarpeta(c));
  }

  /**
   * Carpeta a la que el usuario tiene acceso. Responde 404 (y no 403) cuando es de
   * otra área, para no revelar qué carpetas existen en otros departamentos.
   */
  async obtenerAccesible(id: number, usuario: UsuarioSesion): Promise<Carpeta> {
    const carpeta = await this.carpetaRepository.findOne({ where: { id } });
    if (!carpeta || !puedeAcceder(usuario, carpeta.departamento)) {
      throw new NotFoundException('Carpeta no encontrada');
    }
    return carpeta;
  }

  /** Cadena de carpetas desde la raíz del área hasta `carpeta` (incluida). */
  async cadena(carpeta: Carpeta): Promise<Carpeta[]> {
    const cadena = [carpeta];
    let actual = carpeta;
    while (actual.padreId !== null) {
      if (cadena.length > PROFUNDIDAD_MAXIMA_CARPETAS) {
        throw new InternalServerErrorException('La jerarquía de carpetas tiene un ciclo.');
      }
      const padre = await this.carpetaRepository.findOne({ where: { id: actual.padreId } });
      if (!padre) break;
      cadena.unshift(padre);
      actual = padre;
    }
    return cadena;
  }

  /**
   * Resuelve dónde guardar un documento o una carpeta nueva, aplicando el control de acceso:
   * - Con `carpetaId`: esa carpeta (debe ser accesible); el área es la de la carpeta.
   * - Sin carpeta: raíz del área (los no administradores, siempre la suya).
   */
  async resolverDestino(
    usuario: UsuarioSesion,
    departamento?: string,
    carpetaId?: number,
  ): Promise<DestinoSubida> {
    if (carpetaId) {
      const carpeta = await this.obtenerAccesible(carpetaId, usuario);
      if (departamento?.trim() && !mismoDepartamento(departamento, carpeta.departamento)) {
        throw new BadRequestException('La carpeta seleccionada pertenece a otra área.');
      }
      const cadena = await this.cadena(carpeta);
      return {
        departamento: carpeta.departamento,
        carpeta,
        segmentos: cadena.map((c) => c.nombre),
      };
    }

    return {
      departamento: departamentoParaEscritura(usuario, departamento),
      carpeta: null,
      segmentos: [],
    };
  }

  /* ----------------------------- Crear ------------------------------ */

  async crear(dto: CrearCarpetaDto, usuario: UsuarioSesion): Promise<CarpetaSerializada> {
    const nombre = validarNombreCarpeta(dto.nombre);
    const destino = await this.resolverDestino(usuario, dto.departamento, dto.padreId);
    const carpeta = await this.crearEn(destino, nombre, usuario);
    return serializarCarpeta(carpeta, usuario.nombre);
  }

  /**
   * Para la carga masiva: recorre `nombres` (p. ej. ["Contratos", "2026"]) desde `base`,
   * reutilizando las carpetas que ya existen y creando las que faltan.
   * `cache` evita repetir consultas dentro de la misma subida; `creadas` acumula las nuevas.
   */
  async asegurarRuta(
    base: DestinoSubida,
    nombres: readonly string[],
    usuario: UsuarioSesion,
    cache: Map<string, DestinoSubida>,
    creadas: Carpeta[],
  ): Promise<DestinoSubida> {
    let actual = base;
    for (const nombre of nombres) {
      const clave = `${actual.departamento}|${actual.carpeta?.id ?? 'raiz'}|${normalizarTexto(nombre)}`;
      let siguiente = cache.get(clave);
      if (!siguiente) {
        const existente = await this.buscarHija(
          actual.departamento,
          actual.carpeta?.id ?? null,
          nombre,
        );
        const carpeta = existente ?? (await this.crearEn(actual, nombre, usuario));
        if (!existente) creadas.push(carpeta);
        siguiente = {
          departamento: actual.departamento,
          carpeta,
          segmentos: [...actual.segmentos, carpeta.nombre],
        };
        cache.set(clave, siguiente);
      }
      actual = siguiente;
    }
    return actual;
  }

  private async crearEn(
    destino: DestinoSubida,
    nombre: string,
    usuario: UsuarioSesion,
  ): Promise<Carpeta> {
    if (destino.segmentos.length >= PROFUNDIDAD_MAXIMA_CARPETAS) {
      throw new BadRequestException(
        `No se pueden anidar más de ${PROFUNDIDAD_MAXIMA_CARPETAS} niveles de carpetas.`,
      );
    }

    const padreId = destino.carpeta?.id ?? null;
    if (await this.buscarHija(destino.departamento, padreId, nombre)) {
      throw new ConflictException(`Ya existe una carpeta llamada "${nombre}" en esta ubicación.`);
    }

    const carpeta = await this.carpetaRepository.save(
      this.carpetaRepository.create({
        nombre,
        departamento: destino.departamento,
        padreId,
        usuarioId: usuario.id,
      }),
    );

    await this.auditoria.registrar({
      usuarioId: usuario.id,
      accion: 'CREATE_FOLDER',
      departamento: destino.departamento,
      detalles: `Creó la carpeta "${[...destino.segmentos, nombre].join(' / ')}" (id ${carpeta.id})`,
    });

    return carpeta;
  }

  /** Carpeta hermana con ese nombre (sin distinguir mayúsculas ni tildes), si existe. */
  private async buscarHija(
    departamento: Departamento,
    padreId: number | null,
    nombre: string,
    excluirId?: number,
  ): Promise<Carpeta | null> {
    const hermanas = await this.carpetaRepository.find({
      where: { departamento, padreId: padreId ?? IsNull() },
    });
    const buscado = normalizarTexto(nombre);
    return (
      hermanas.find((c) => c.id !== excluirId && normalizarTexto(c.nombre) === buscado) ?? null
    );
  }

  /* --------------------------- Renombrar ---------------------------- */

  /**
   * Cambia el nombre de la carpeta y reubica en Cloudflare R2 los objetos de la carpeta
   * y de todas sus subcarpetas (las claves contienen el nombre de la carpeta):
   *
   *   1. Copia cada objeto a su clave nueva. Si alguna copia falla, borra las copias
   *      hechas y responde error: ni la BD ni los originales cambian.
   *   2. En una transacción actualiza el nombre de la carpeta y la clave/URL de cada
   *      documento. Si falla, borra las copias: los originales siguen siendo válidos.
   *   3. Borra los objetos originales, que ya nadie referencia.
   *
   * Si el nombre nuevo produce el mismo prefijo (p. ej. "facturas" → "Facturas"),
   * solo se actualiza la BD.
   */
  async renombrar(
    id: number,
    dto: RenombrarCarpetaDto,
    usuario: UsuarioSesion,
  ): Promise<CarpetaSerializada> {
    const carpeta = await this.obtenerAccesible(id, usuario);
    const nombre = validarNombreCarpeta(dto.nombre);
    const anterior = carpeta.nombre;

    if (nombre !== anterior) {
      if (await this.buscarHija(carpeta.departamento, carpeta.padreId, nombre, carpeta.id)) {
        throw new ConflictException(`Ya existe una carpeta llamada "${nombre}" en esta ubicación.`);
      }

      const reubicados = await this.renombrarYReubicar(carpeta, nombre);

      await this.auditoria.registrar({
        usuarioId: usuario.id,
        accion: 'RENAME_FOLDER',
        departamento: carpeta.departamento,
        detalles:
          `Renombró la carpeta "${anterior}" a "${nombre}" (id ${carpeta.id})` +
          (reubicados > 0 ? `; ${reubicados} archivo(s) reubicados en R2` : ''),
      });
    }

    const actualizada = await this.carpetaRepository.findOne({
      where: { id: carpeta.id },
      relations: { usuario: true },
    });
    return serializarCarpeta(actualizada ?? { ...carpeta, nombre });
  }

  /** Devuelve cuántos objetos se movieron en R2. */
  private async renombrarYReubicar(carpeta: Carpeta, nombre: string): Promise<number> {
    // Todo el árbol del área en memoria: rutas nuevas y subcarpetas sin N consultas.
    const delArea = await this.carpetaRepository.find({
      where: { departamento: carpeta.departamento },
    });
    const porId = new Map(delArea.map((c) => [c.id, { ...c }]));
    porId.set(carpeta.id, { ...carpeta, nombre }); // el nombre nuevo, solo en memoria

    const afectadas = idsSubarbol(carpeta.id, [...porId.values()]);
    const documentos = await this.documentoRepository.find({
      where: { carpetaId: In(afectadas) },
    });

    const movimientos = documentos
      .filter((doc) => estaEnR2(doc) && doc.carpetaId !== null)
      .map((doc) => ({
        doc,
        origen: doc.nombreGuardado,
        destino: reubicarClave(
          doc.nombreGuardado,
          carpeta.departamento,
          nombresDesdeRaiz(doc.carpetaId!, porId),
        ),
      }))
      .filter((m) => m.origen !== m.destino);

    if (movimientos.length > 0 && !this.almacenamiento.usaR2) {
      throw new InternalServerErrorException(
        'La carpeta contiene archivos en Cloudflare R2, pero R2 no está configurado en el servidor.',
      );
    }

    // 1) Copiar a las claves nuevas.
    const copiadas: string[] = [];
    try {
      await enParalelo(movimientos, CONCURRENCIA_COPIAS, async (m) => {
        await this.almacenamiento.copiarEnR2(m.origen, m.destino);
        copiadas.push(m.destino);
      });
    } catch (err) {
      this.logger.error(
        `Error copiando objetos al renombrar la carpeta ${carpeta.id}`,
        err as Error,
      );
      await this.almacenamiento.eliminarClavesR2(copiadas);
      throw new InternalServerErrorException(
        'No se pudieron mover los archivos de la carpeta en Cloudflare R2. ' +
          'No se realizó ningún cambio; inténtalo de nuevo.',
      );
    }

    // 2) Nombre de la carpeta + claves de los documentos, todo o nada.
    try {
      await this.carpetaRepository.manager.transaction(async (em) => {
        await em.update(Carpeta, { id: carpeta.id }, { nombre });
        for (const m of movimientos) {
          await em.update(
            Documento,
            { id: m.doc.id },
            { nombreGuardado: m.destino, ruta: this.almacenamiento.urlR2(m.destino) },
          );
        }
      });
    } catch (err) {
      await this.almacenamiento.eliminarClavesR2(copiadas);
      throw err;
    }

    // 3) Los originales ya no los referencia nadie.
    await this.almacenamiento.eliminarClavesR2(movimientos.map((m) => m.origen));

    return movimientos.length;
  }
}
