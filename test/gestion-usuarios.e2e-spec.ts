import { Test, TestingModule } from '@nestjs/testing';
import { CanActivate, ExecutionContext, INestApplication, Injectable } from '@nestjs/common';
import request from 'supertest';
import { jest } from '@jest/globals';
import { JwtAuthGuard } from './../src/usuarios/jwt-auth.guard';
import { UsersController } from './../src/usuarios/users.controller';
import { GestionUsuariosService } from './../src/usuarios/gestion-usuarios.service';
import type * as ModControlador from './../src/usuarios/usuarios.controller.js';
import type * as ModServicio from './../src/usuarios/usuarios.service.js';

// @nestjs-modules/mailer (CommonJS) no se puede cargar con Jest en modo ESM: se simula
// antes de importar (de forma dinámica) UsuariosController/UsuariosService, que dependen de él.
jest.unstable_mockModule('@nestjs-modules/mailer', () => ({ MailerService: class {} }));

/** Sustituye a JwtAuthGuard: el usuario llega en la cabecera x-test-user. RolesGuard es el real. */
@Injectable()
class UsuarioDePrueba implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string>; user?: unknown }>();
    if (!req.headers['x-test-user']) return false;
    req.user = JSON.parse(decodeURIComponent(req.headers['x-test-user']));
    return true;
  }
}

const cabecera = (u: object) => encodeURIComponent(JSON.stringify(u));
const ADMIN = cabecera({ id: 1, nombre: 'Admin', rol: 'admin', departamento: 'Gerencia' });
const ANA = cabecera({ id: 2, nombre: 'Ana', rol: 'USUARIO ', departamento: 'SST' });

describe('Gestión de usuarios (HTTP)', () => {
  let app: INestApplication;
  const gestion = {
    listar: jest.fn(() => Promise.resolve([{ id: 5 }])),
    actualizar: jest.fn(() => Promise.resolve({ id: 5 })),
  };
  const usuariosService = {
    findAll: jest.fn(() => Promise.resolve([])),
    findOne: jest.fn(() => Promise.resolve({})),
    crearUsuarioPorAdmin: jest.fn(() => Promise.resolve({})),
  };

  beforeAll(async () => {
    const { UsuariosController } =
      (await import('./../src/usuarios/usuarios.controller.js')) as typeof ModControlador;
    const { UsuariosService } =
      (await import('./../src/usuarios/usuarios.service.js')) as typeof ModServicio;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [UsersController, UsuariosController],
      providers: [
        { provide: GestionUsuariosService, useValue: gestion },
        { provide: UsuariosService, useValue: usuariosService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(UsuarioDePrueba)
      .compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const http = () => request(app.getHttpServer());

  it('sin sesión: GET /users y PATCH /users/:id rechazados', async () => {
    await http().get('/users').expect(403);
    await http().patch('/users/5').send({ departamento: 'SST' }).expect(403);
    expect(gestion.listar).not.toHaveBeenCalled();
  });

  it('un usuario normal no puede ver ni modificar usuarios', async () => {
    await http().get('/users').set('x-test-user', ANA).expect(403);
    await http()
      .patch('/users/2')
      .set('x-test-user', ANA)
      .send({ departamento: 'Gerencia' })
      .expect(403);
    expect(gestion.listar).not.toHaveBeenCalled();
    expect(gestion.actualizar).not.toHaveBeenCalled();
  });

  it('el administrador lista usuarios', async () => {
    const r = await http().get('/users').set('x-test-user', ADMIN).expect(200);
    expect(r.body).toEqual([{ id: 5 }]);
  });

  it('PATCH normaliza el correo y descarta campos no permitidos (rol, contraseña)', async () => {
    await http()
      .patch('/users/5')
      .set('x-test-user', ADMIN)
      .send({ email: '  Karla@Empresa.com ', departamento: 'SST', rol: 'admin', contrasena: 'x' })
      .expect(200);
    expect(gestion.actualizar).toHaveBeenCalledWith(
      5,
      { email: 'karla@empresa.com', departamento: 'SST' },
      expect.objectContaining({ id: 1 }),
    );
  });

  it.each([
    ['área fuera de la lista', { departamento: 'Producción' }],
    ['área con mayúsculas distintas', { departamento: 'sst' }],
    ['correo inválido', { email: 'no-es-correo' }],
    ['correo null', { email: null }],
    ['área null', { departamento: null }],
  ])('PATCH rechaza %s con 400', async (_caso, cuerpo) => {
    await http().patch('/users/5').set('x-test-user', ADMIN).send(cuerpo).expect(400);
    expect(gestion.actualizar).not.toHaveBeenCalled();
  });

  it('PATCH exige un id numérico', async () => {
    await http()
      .patch('/users/abc')
      .set('x-test-user', ADMIN)
      .send({ departamento: 'SST' })
      .expect(400);
  });

  it('los endpoints antiguos de /usuarios también son solo para administradores', async () => {
    await http().get('/usuarios').set('x-test-user', ANA).expect(403);
    await http().get('/usuarios/5').set('x-test-user', ANA).expect(403);
    await http().post('/usuarios/crear').send({ rol: 'admin' }).expect(403);
    await http().post('/usuarios/crear').set('x-test-user', ANA).send({ rol: 'admin' }).expect(403);
    expect(usuariosService.findAll).not.toHaveBeenCalled();
    expect(usuariosService.crearUsuarioPorAdmin).not.toHaveBeenCalled();

    await http().get('/usuarios').set('x-test-user', ADMIN).expect(200);
  });
});
