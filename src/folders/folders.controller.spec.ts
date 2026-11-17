import { Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';
import { JwtAuthGuard } from '../usuarios/jwt-auth.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ROLES_ADMIN, type UsuarioSesion } from '../auth/usuario-sesion';

const admin: UsuarioSesion = {
  id: 1,
  nombre: 'Admin',
  correo: 'admin@empresa.com',
  rol: 'Administrador',
  departamento: 'Gerencia',
};

describe('FoldersController', () => {
  let controller: FoldersController;
  const foldersService = {
    listar: jest.fn(),
    crear: jest.fn(),
    renombrar: jest.fn(),
    eliminarCarpeta: jest.fn(() =>
      Promise.resolve({
        mensaje: 'Carpeta "Fichas" eliminada correctamente',
        carpetasEliminadas: 2,
        documentosEliminados: 3,
      }),
    ),
  };

  beforeEach(async () => {
    // Silencia los logs de error esperados sin tocar el Logger real.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FoldersController],
      providers: [{ provide: FoldersService, useValue: foldersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<FoldersController>(FoldersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('eliminar pasa el id de la carpeta y el usuario autenticado al servicio', async () => {
    await expect(controller.eliminar(10, admin)).resolves.toMatchObject({
      carpetasEliminadas: 2,
      documentosEliminados: 3,
    });
    expect(foldersService.eliminarCarpeta).toHaveBeenCalledWith(10, admin);
  });

  it('eliminar está reservado a los administradores (como borrar documentos)', () => {
    // @Roles() guarda los metadatos en la función del handler.
    const handler = Object.getOwnPropertyDescriptor(FoldersController.prototype, 'eliminar')
      ?.value as (...args: unknown[]) => unknown;
    expect(new Reflector().get<string[]>(ROLES_KEY, handler)).toEqual(ROLES_ADMIN);
  });
});
