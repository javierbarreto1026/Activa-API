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
  let doc: Documento;
  let urlFirmada: jest.Mock<AlmacenamientoService['urlFirmada']>;

  beforeEach(async () => {
    doc = docContabilidad;
    urlFirmada = jest.fn<AlmacenamientoService['urlFirmada']>(() =>
      Promise.resolve('https://firmada'),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentsService,
        {
          provide: getRepositoryToken(Documento),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(() => Promise.resolve(doc)),
            delete: jest.fn(),
          },
        },
        {
          provide: AlmacenamientoService,
          useValue: { guardar: jest.fn(), eliminar: jest.fn(), urlFirmada },
        },
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

  describe('vistaPrevia', () => {
    const lector = usuario('usuario', 'Contabilidad');

    it('devuelve una URL firmada inline con el tipo MIME para PDFs en B2', async () => {
      doc = { ...docContabilidad, nombreOriginal: 'Acta.PDF' };

      await expect(service.vistaPrevia(7, lector)).resolves.toEqual({
        id: 7,
        nombre: 'Acta.PDF',
        mimeType: 'application/pdf',
        extension: 'pdf',
        visor: 'pdf',
        previsualizable: true,
        url: 'https://firmada',
        requiereToken: false,
      });
      expect(urlFirmada).toHaveBeenCalledWith(doc, { inline: true, tipoMime: 'application/pdf' });
    });

    it('firma también Excel/Word/PowerPoint para el visor de Office Online', async () => {
      await expect(service.vistaPrevia(7, lector)).resolves.toMatchObject({
        extension: 'xlsx',
        visor: 'office',
        previsualizable: true,
        url: 'https://firmada',
      });
      expect(urlFirmada).toHaveBeenCalledWith(doc, {
        inline: true,
        tipoMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    });

    it('sirve los CSV como texto plano para que el navegador los muestre', async () => {
      doc = { ...docContabilidad, nombreOriginal: 'nomina.csv' };

      await expect(service.vistaPrevia(7, lector)).resolves.toMatchObject({ visor: 'texto' });
      expect(urlFirmada).toHaveBeenCalledWith(doc, {
        inline: true,
        tipoMime: 'text/plain; charset=utf-8',
      });
    });

    it('en el respaldo local devuelve la ruta de descarga protegida por JWT', async () => {
      doc = { ...docContabilidad, nombreOriginal: 'foto.jpg' };
      urlFirmada.mockResolvedValue(null);

      await expect(service.vistaPrevia(7, lector)).resolves.toMatchObject({
        mimeType: 'image/jpeg',
        visor: 'imagen',
        url: '/documents/7/download',
        requiereToken: true,
      });
    });

    it('no firma nada para formatos sin visor (p. ej. registros antiguos .zip)', async () => {
      doc = { ...docContabilidad, nombreOriginal: 'respaldo.zip' };

      await expect(service.vistaPrevia(7, lector)).resolves.toMatchObject({
        extension: 'zip',
        visor: null,
        previsualizable: false,
        url: null,
      });
      expect(urlFirmada).not.toHaveBeenCalled();
    });

    it('responde 404 si el documento es de otra área', async () => {
      await expect(service.vistaPrevia(7, usuario('usuario', 'SST'))).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(urlFirmada).not.toHaveBeenCalled();
    });
  });
});
