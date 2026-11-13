import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditModule } from './../src/audit/audit.module';
import { FoldersModule } from './../src/folders/folders.module';
import { DocumentsModule } from './../src/documents/documents.module';
import { AuditLog } from './../src/audit/audit-log.entity';
import { Carpeta } from './../src/folders/carpeta.entity';
import { Documento } from './../src/documents/documento.entity';

/**
 * Compila los módulos reales con sus guards (sin reemplazar JwtAuthGuard), para
 * detectar dependencias que falten, como AuthModuleOptions de PassportModule.
 * Solo se simulan los repositorios, para no necesitar base de datos.
 */
describe('Módulos (inyección de dependencias)', () => {
  it.each([
    ['AuditModule', AuditModule],
    ['FoldersModule', FoldersModule],
    ['DocumentsModule', DocumentsModule],
  ])('%s resuelve todas sus dependencias', async (_nombre, modulo) => {
    const builder = Test.createTestingModule({ imports: [modulo] });
    for (const entidad of [AuditLog, Carpeta, Documento]) {
      builder.overrideProvider(getRepositoryToken(entidad)).useValue({});
    }
    const app = (await builder.compile()).createNestApplication();
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
