import { jest } from '@jest/globals';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AlmacenamientoService } from './almacenamiento.service';
import { cargarConfigB2 } from './b2.config';

const ENV_B2: Record<string, string> = {
  B2_ENDPOINT: 's3.us-east-005.backblazeb2.com',
  B2_REGION: 'us-east-005',
  B2_KEY_ID: '005abc123def4560000000001',
  B2_APPLICATION_KEY: 'K005ClaveFicticiaDePrueba1234567',
  B2_BUCKET_NAME: 'bucket-prueba',
};

/** Mock mínimo de ConfigService: solo `get`, leyendo del objeto dado. */
const configMock = (env: Record<string, string>) =>
  ({ get: jest.fn((clave: string) => env[clave]) }) as unknown as ConfigService;

describe('AlmacenamientoService (Backblaze B2)', () => {
  let send: jest.SpiedFunction<S3Client['send']>;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    send = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation((() => Promise.resolve({})) as never);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lee endpoint y región reales desde ConfigService (sin region "auto")', async () => {
    const config = cargarConfigB2(configMock(ENV_B2))!;
    expect(config.endpoint).toBe('https://s3.us-east-005.backblazeb2.com');
    expect(config.region).toBe('us-east-005');

    const servicio = new AlmacenamientoService(configMock(ENV_B2));
    expect(servicio.usaB2).toBe(true);
    const cliente = (servicio as unknown as { b2: { cliente: S3Client } }).b2.cliente;
    await expect(cliente.config.region()).resolves.toBe('us-east-005');
  });

  it('usa el bucket de B2_BUCKET_NAME en subidas, descargas, copias y borrados', async () => {
    const servicio = new AlmacenamientoService(configMock(ENV_B2));

    const guardado = await servicio.guardar(
      'area/a.pdf',
      { buffer: Buffer.from('x'), mimetype: 'application/pdf', size: 1 },
      'a.pdf',
    );
    expect(guardado).toEqual({
      ruta: 'https://s3.us-east-005.backblazeb2.com/bucket-prueba/area/a.pdf',
      nombreGuardado: 'area/a.pdf',
    });
    await servicio.obtener({ ...guardado, nombreOriginal: 'a.pdf' });
    await servicio.copiarEnB2('area/a.pdf', 'area/b.pdf');
    await servicio.eliminarClavesB2(['area/a.pdf']);

    const comandos = send.mock.calls.map(([comando]) => comando);
    expect(comandos.map((c) => c.constructor)).toEqual([
      PutObjectCommand,
      GetObjectCommand,
      CopyObjectCommand,
      DeleteObjectCommand,
    ]);
    for (const c of comandos) {
      expect((c.input as { Bucket: string }).Bucket).toBe('bucket-prueba');
    }
    expect((comandos[2].input as { CopySource: string }).CopySource).toBe(
      'bucket-prueba/area/a.pdf',
    );
  });

  it('sin variables de B2 usa el respaldo local', () => {
    const servicio = new AlmacenamientoService(configMock({}));
    expect(servicio.usaB2).toBe(false);
  });

  it('rechaza una región que no coincide con el endpoint', () => {
    const servicio = new AlmacenamientoService(
      configMock({ ...ENV_B2, B2_REGION: 'eu-central-003' }),
    );
    expect(servicio.usaB2).toBe(false);
  });
});
