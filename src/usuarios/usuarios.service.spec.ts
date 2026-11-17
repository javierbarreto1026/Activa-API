import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { MailerService } from '@nestjs-modules/mailer';
import { Repository } from 'typeorm';
import { jest } from '@jest/globals';
import type { Usuario } from './usuario.entity';
import type { AuditService } from '../audit/audit.service';
import type * as ModServicio from './usuarios.service.js';

// @nestjs-modules/mailer (CommonJS) no se puede cargar con Jest en modo ESM: se simula
// antes de importar (de forma dinámica) UsuariosService, que depende de él.
jest.unstable_mockModule('@nestjs-modules/mailer', () => ({ MailerService: class {} }));

const ADMIN_ID = 1;

const karla = (): Partial<Usuario> => ({
  id: 5,
  nombre: 'Karla Gómez',
  correo: 'karla@empresa.com',
  departamento: 'SST',
});

describe('UsuariosService.eliminarUsuario', () => {
  let repo: {
    findOne: jest.Mock<(...a: unknown[]) => Promise<Partial<Usuario> | null>>;
    softDelete: jest.Mock<(...a: unknown[]) => Promise<unknown>>;
    delete: jest.Mock<(...a: unknown[]) => Promise<unknown>>;
  };
  let auditoria: { registrar: jest.Mock<(...a: unknown[]) => Promise<void>> };
  let service: InstanceType<typeof ModServicio.UsuariosService>;

  beforeEach(async () => {
    const { UsuariosService } = (await import('./usuarios.service.js')) as typeof ModServicio;
    repo = {
      findOne: jest.fn(() => Promise.resolve(karla())),
      softDelete: jest.fn(() => Promise.resolve({ affected: 1 })),
      delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    auditoria = { registrar: jest.fn(() => Promise.resolve()) };
    service = new UsuariosService(
      repo as unknown as Repository<Usuario>,
      {} as ConfigService,
      {} as JwtService,
      {} as MailerService,
      auditoria as unknown as AuditService,
    );
  });

  it('aplica borrado lógico (nunca DELETE físico) y lo registra en auditoría', async () => {
    const r = await service.eliminarUsuario(5, ADMIN_ID);

    expect(repo.softDelete).toHaveBeenCalledWith({ id: 5 });
    expect(repo.delete).not.toHaveBeenCalled();
    expect(auditoria.registrar).toHaveBeenCalledWith({
      usuarioId: ADMIN_ID,
      accion: 'DELETE_USER',
      departamento: 'SST',
      detalles: expect.stringContaining('Karla Gómez (#5, karla@empresa.com)') as string,
    });
    expect(r.message).toContain('Karla Gómez');
  });

  it('el administrador no puede eliminarse a sí mismo (400, sin tocar la BD)', async () => {
    await expect(service.eliminarUsuario(ADMIN_ID, ADMIN_ID)).rejects.toThrow(BadRequestException);
    expect(repo.findOne).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('404 si el usuario no existe o ya fue eliminado', async () => {
    repo.findOne.mockResolvedValueOnce(null);
    await expect(service.eliminarUsuario(99, ADMIN_ID)).rejects.toThrow(NotFoundException);
    expect(repo.softDelete).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });
});
