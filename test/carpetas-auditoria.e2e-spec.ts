import { Test, TestingModule } from '@nestjs/testing';
import { CanActivate, ExecutionContext, INestApplication, Injectable } from '@nestjs/common';
import request from 'supertest';
import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';
import { of } from 'rxjs';
import { JwtAuthGuard } from './../src/usuarios/jwt-auth.guard';
import { DocumentsController } from './../src/documents/documents.controller';
import { DocumentsService } from './../src/documents/documents.service';
import { FoldersController } from './../src/folders/folders.controller';
import { FoldersService } from './../src/folders/folders.service';
import { AuditController } from './../src/audit/audit.controller';
import { AuditService } from './../src/audit/audit.service';
import { LimiteTamanoLoteInterceptor } from './../src/documents/upload.config';
import { Usuario } from './../src/usuarios/usuario.entity';
import { Documento } from './../src/documents/documento.entity';
import { Carpeta } from './../src/folders/carpeta.entity';
import { AuditLog } from './../src/audit/audit-log.entity';

/**
 * Sustituye a JwtAuthGuard: toma el usuario de la cabecera x-test-user
 * (JSON codificado con encodeURIComponent: las cabeceras HTTP son latin1).
 */
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

const cabeceraUsuario = (u: object) => encodeURIComponent(JSON.stringify(u));
const ADMIN = cabeceraUsuario({
  id: 1,
  nombre: 'Admin',
  rol: 'Administrador',
  departamento: 'Gerencia',
});
const ANA = cabeceraUsuario({ id: 2, nombre: 'Ana', rol: 'usuario', departamento: 'SST' });
const PDF = Buffer.from('%PDF-1.4\n%prueba');

describe('Carpetas, carga masiva y auditoría (HTTP)', () => {
  let app: INestApplication;
  const documentsService = { guardarCarpeta: jest.fn(() => Promise.resolve({ subidos: 2 })) };
  const foldersService = {
    crear: jest.fn(() => Promise.resolve({ id: 5 })),
    renombrar: jest.fn(() => Promise.resolve({ id: 5 })),
    listar: jest.fn(() => Promise.resolve([])),
  };
  const auditService = { listar: jest.fn(() => Promise.resolve({ data: [] })) };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController, FoldersController, AuditController],
      providers: [
        { provide: DocumentsService, useValue: documentsService },
        { provide: FoldersService, useValue: foldersService },
        { provide: AuditService, useValue: auditService },
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

  it('GET /logs es solo para administradores', async () => {
    await request(app.getHttpServer()).get('/logs').set('x-test-user', ANA).expect(403);
    await request(app.getHttpServer())
      .get('/logs?pagina=2&accion=CREATE_FOLDER')
      .set('x-test-user', ADMIN)
      .expect(200);
    expect(auditService.listar).toHaveBeenCalledWith(
      expect.objectContaining({ pagina: 2, accion: 'CREATE_FOLDER' }),
    );
  });

  it('GET /logs valida la acción', async () => {
    await request(app.getHttpServer())
      .get('/logs?accion=HACKEAR')
      .set('x-test-user', ADMIN)
      .expect(400);
  });

  it('sin sesión no se accede a carpetas', async () => {
    await request(app.getHttpServer()).get('/folders').expect(403);
  });

  it('POST /folders convierte padreId a número y pasa el usuario', async () => {
    await request(app.getHttpServer())
      .post('/folders')
      .set('x-test-user', ANA)
      .send({ nombre: 'Contratos', padreId: '4', extra: 'se descarta' })
      .expect(201);
    expect(foldersService.crear).toHaveBeenCalledWith(
      { nombre: 'Contratos', padreId: 4 },
      expect.objectContaining({ id: 2, departamento: 'SST' }),
    );
  });

  it('PATCH /folders/:id exige id numérico y nombre', async () => {
    await request(app.getHttpServer())
      .patch('/folders/abc')
      .set('x-test-user', ANA)
      .send({ nombre: 'X' })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/folders/5')
      .set('x-test-user', ANA)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch('/folders/5')
      .set('x-test-user', ANA)
      .send({ nombre: 'Nuevo' })
      .expect(200);
    expect(foldersService.renombrar).toHaveBeenCalledWith(
      5,
      { nombre: 'Nuevo' },
      expect.objectContaining({ id: 2 }),
    );
  });

  it('POST /documents/upload-carpeta recibe varios archivos, rutas y carpetaId', async () => {
    const rutas = ['Fichas/Producción.pdf', 'Fichas/2026/manual.pdf'];
    await request(app.getHttpServer())
      .post('/documents/upload-carpeta')
      .set('x-test-user', ANA)
      .field('carpetaId', '7')
      .field('rutas', JSON.stringify(rutas))
      .attach('files', PDF, { filename: 'Producción.pdf', contentType: 'application/pdf' })
      .attach('files', PDF, { filename: 'manual.pdf', contentType: 'application/pdf' })
      .expect(201);

    const [files, usuario, datos] = documentsService.guardarCarpeta.mock.calls[0] as unknown as [
      Express.Multer.File[],
      { id: number },
      { carpetaId: number; rutas: string },
    ];
    // Mismo orden que se adjuntaron, y el nombre con tilde llega bien (defParamCharset utf8).
    expect(files.map((f) => f.originalname)).toEqual(['Producción.pdf', 'manual.pdf']);
    expect(usuario.id).toBe(2);
    expect(datos.carpetaId).toBe(7);
    expect(JSON.parse(datos.rutas)).toEqual(rutas);
  });

  it('POST /documents/upload-carpeta rechaza más archivos de los permitidos por lote', async () => {
    let peticion = request(app.getHttpServer())
      .post('/documents/upload-carpeta')
      .set('x-test-user', ANA)
      .field('rutas', '[]');
    for (let i = 0; i < 21; i++) {
      peticion = peticion.attach('files', PDF, {
        filename: `a${i}.pdf`,
        contentType: 'application/pdf',
      });
    }
    await peticion.expect(400);
    expect(documentsService.guardarCarpeta).not.toHaveBeenCalled();
  });
});

describe('LimiteTamanoLoteInterceptor', () => {
  const contexto = (cabeceras: Record<string, string>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers: cabeceras }) }),
    }) as unknown as ExecutionContext;
  const siguiente = { handle: () => of('ok') };
  const interceptor = new LimiteTamanoLoteInterceptor();

  it('deja pasar lotes dentro del límite', () => {
    expect(() =>
      interceptor.intercept(contexto({ 'content-length': '1048576' }), siguiente),
    ).not.toThrow();
  });

  it('rechaza con 413 los lotes de más de 100 MB y con 411 si falta Content-Length', () => {
    const grande = String(101 * 1024 * 1024);
    expect(() => interceptor.intercept(contexto({ 'content-length': grande }), siguiente)).toThrow(
      expect.objectContaining({ status: 413 }),
    );
    expect(() => interceptor.intercept(contexto({}), siguiente)).toThrow(
      expect.objectContaining({ status: 411 }),
    );
  });
});

describe('Entidades TypeORM', () => {
  it('los metadatos de Usuario, Documento, Carpeta y AuditLog son válidos (sin conectar)', async () => {
    const ds = new DataSource({
      type: 'mysql',
      database: 'solo_metadatos', // nunca se conecta
      entities: [Usuario, Documento, Carpeta, AuditLog],
    });
    // buildMetadatas construye y valida relaciones, columnas e índices sin abrir conexión.
    await (ds as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();

    const carpeta = ds.getMetadata(Carpeta);
    expect(carpeta.tableName).toBe('carpetas');
    expect(carpeta.relations.map((r) => r.propertyName).sort()).toEqual([
      'documentos',
      'padre',
      'subcarpetas',
      'usuario',
    ]);
    // Solo los ManyToOne generan claves foráneas: padreId → carpetas, usuarioId → usuarios.
    expect(carpeta.foreignKeys.map((fk) => fk.columnNames.join())).toEqual(
      expect.arrayContaining(['padreId', 'usuarioId']),
    );
    expect(carpeta.foreignKeys).toHaveLength(2);

    const documento = ds.getMetadata(Documento);
    expect(documento.findColumnWithPropertyName('carpetaId')?.isNullable).toBe(true);
    expect(documento.foreignKeys.map((fk) => fk.columnNames.join()).sort()).toEqual([
      'carpetaId',
      'usuarioId',
    ]);

    // Las áreas son ENUM con exactamente los cuatro valores oficiales.
    for (const meta of [carpeta, documento]) {
      const columna = meta.findColumnWithPropertyName('departamento')!;
      expect(columna.type).toBe('enum');
      expect(columna.enum).toEqual(['Contabilidad', 'Recursos Humanos', 'SST', 'Gerencia']);
    }

    const log = ds.getMetadata(AuditLog);
    expect(log.tableName).toBe('audit_logs');
    expect(log.columns.map((c) => c.propertyName)).toEqual(
      expect.arrayContaining(['id', 'userId', 'action', 'department', 'details', 'createdAt']),
    );
    // Sin clave foránea hacia usuarios: el historial sobrevive al borrado de usuarios.
    expect(log.foreignKeys).toHaveLength(0);
  });
});
