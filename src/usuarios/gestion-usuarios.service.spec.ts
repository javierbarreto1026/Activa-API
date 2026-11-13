import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { jest } from '@jest/globals';
import { GestionUsuariosService } from './gestion-usuarios.service';
import { Usuario } from './usuario.entity';
import type { AuditService } from '../audit/audit.service';
import type { UsuarioSesion } from '../auth/usuario-sesion';

const admin: UsuarioSesion = {
  id: 1,
  nombre: 'Admin',
  correo: 'admin@empresa.com',
  rol: 'Administrador',
  departamento: 'Gerencia',
};

const karla = (): Usuario => ({
  id: 5,
  nombre: 'Karla Gómez',
  correo: 'karla@empresa.com',
  contrasena: '$2b$10$hash',
  rol: 'USUARIO ',
  departamento: 'SST',
  codigoRecuperacion: '123456',
  expiracionCodigo: new Date(),
  fecha_creacion: new Date('2026-01-01'),
});

describe('GestionUsuariosService', () => {
  let repo: {
    find: jest.Mock<(...a: unknown[]) => Promise<Usuario[]>>;
    findOne: jest.Mock<(...a: unknown[]) => Promise<Usuario | null>>;
    exists: jest.Mock<(...a: unknown[]) => Promise<boolean>>;
    update: jest.Mock<(...a: unknown[]) => Promise<unknown>>;
  };
  let auditoria: { registrar: jest.Mock<(...a: unknown[]) => Promise<void>> };
  let service: GestionUsuariosService;

  beforeEach(() => {
    repo = {
      find: jest.fn(() => Promise.resolve([karla()])),
      findOne: jest.fn(() => Promise.resolve(karla())),
      exists: jest.fn(() => Promise.resolve(false)),
      update: jest.fn(() => Promise.resolve({})),
    };
    auditoria = { registrar: jest.fn(() => Promise.resolve()) };
    service = new GestionUsuariosService(
      repo as unknown as Repository<Usuario>,
      auditoria as unknown as AuditService,
    );
  });

  it('listar no expone la contraseña ni el código de recuperación', async () => {
    const [u] = await service.listar();
    expect(u).toEqual({
      id: 5,
      nombre: 'Karla Gómez',
      email: 'karla@empresa.com',
      rol: 'USUARIO',
      departamento: 'SST',
      fechaCreacion: new Date('2026-01-01'),
    });
    const opciones = repo.find.mock.calls[0][0] as { select: Record<string, boolean> };
    expect(opciones.select.contrasena).toBeUndefined();
  });

  it('exige al menos un campo', async () => {
    await expect(service.actualizar(5, {}, admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('404 si el usuario no existe', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    await expect(
      service.actualizar(99, { departamento: 'Gerencia' }, admin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cambia correo y área, invalida el código de recuperación y audita', async () => {
    const r = await service.actualizar(
      5,
      { email: 'karla.gomez@empresa.com', departamento: 'Gerencia' },
      admin,
    );

    expect(repo.update).toHaveBeenCalledWith(
      { id: 5 },
      {
        correo: 'karla.gomez@empresa.com',
        departamento: 'Gerencia',
        codigoRecuperacion: null,
        expiracionCodigo: null,
      },
    );
    expect(r).toMatchObject({ email: 'karla.gomez@empresa.com', departamento: 'Gerencia' });
    expect(r).not.toHaveProperty('contrasena');
    expect(r).not.toHaveProperty('codigoRecuperacion');
    expect(auditoria.registrar).toHaveBeenCalledWith({
      usuarioId: 1,
      accion: 'UPDATE_USER',
      departamento: 'Gerencia',
      detalles:
        'Karla Gómez (#5): correo karla@empresa.com → karla.gomez@empresa.com; área SST → Gerencia',
    });
  });

  it('solo el área: no toca el correo ni el código de recuperación', async () => {
    await service.actualizar(5, { departamento: 'Contabilidad' }, admin);
    expect(repo.update).toHaveBeenCalledWith({ id: 5 }, { departamento: 'Contabilidad' });
    expect(repo.exists).not.toHaveBeenCalled();
  });

  it('409 si el correo ya pertenece a otro usuario', async () => {
    repo.exists.mockResolvedValueOnce(true);
    await expect(
      service.actualizar(5, { email: 'otro@empresa.com' }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('409 si el índice único rechaza el correo (carrera entre dos peticiones)', async () => {
    repo.update.mockRejectedValueOnce(
      Object.assign(new Error('Duplicate entry'), { driverError: { code: 'ER_DUP_ENTRY' } }),
    );
    await expect(
      service.actualizar(5, { email: 'otro@empresa.com' }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('sin cambios reales no escribe ni audita', async () => {
    const r = await service.actualizar(
      5,
      { email: 'karla@empresa.com', departamento: 'SST' },
      admin,
    );
    expect(r.email).toBe('karla@empresa.com');
    expect(repo.update).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
});
