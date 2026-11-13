import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Documento } from './documento.entity';
import { AlmacenamientoService } from '../storage/almacenamiento.service';
import { FoldersService } from '../folders/folders.service';
import { AuditService } from '../audit/audit.service';
import type { UsuarioSesion } from '../auth/usuario-sesion';
import { jest } from '@jest/globals';

const docContabilidad = {
  id: 7,
  nombreOriginal: 'balance.xlsx',
  departamento: 'Contabilidad',
} as Documento;

const usuario = (rol: string, departamento: string): UsuarioSesion => ({
  id: 1,
  nombre: 'Prueba',
  correo: 'prueba@empresa.com',
  rol,
  departamento,
});

describe('DocumentsService', () => {
  let service: DocumentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        {
          provide: getRepositoryToken(Documento),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(() => Promise.resolve(docContabilidad)),
            delete: jest.fn(),
          },
        },
        { provide: AlmacenamientoService, useValue: { guardar: jest.fn(), eliminar: jest.fn() } },
        { provide: FoldersService, useValue: { resolverDestino: jest.fn() } },
        { provide: AuditService, useValue: { registrar: jest.fn() } },
      ],
    }).compile();

    service = module.get<DocumentsService>(DocumentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('responde 404 si un usuario pide un documento de otra área', async () => {
    await expect(service.findOne(7, usuario('usuario', 'SST'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('permite el documento al usuario del área (sin distinguir tildes) y al administrador', async () => {
    await expect(service.findOne(7, usuario('usuario', 'contabilidad'))).resolves.toBe(
      docContabilidad,
    );
    await expect(service.findOne(7, usuario('Administrador', 'Gerencia'))).resolves.toBe(
      docContabilidad,
    );
  });
});
