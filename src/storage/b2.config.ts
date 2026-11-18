import { S3Client } from '@aws-sdk/client-s3';
import type { ConfigService } from '@nestjs/config';

/**
 * Configuración de Backblaze B2 (API compatible con S3).
 *
 * B2 implementa la API de S3, por eso se usa el cliente de '@aws-sdk/client-s3'.
 * A diferencia de Cloudflare R2, B2 exige la región real del bucket (p. ej.
 * "us-east-005"); con region 'auto' rechaza las firmas.
 */
export interface ConfigB2 {
  /** Endpoint S3 del bucket, siempre con "https://" y sin "/" final. */
  endpoint: string;
  region: string;
  keyId: string;
  applicationKey: string;
  bucket: string;
}

/** Variables del .env que necesita Backblaze B2. */
export const VARIABLES_B2 = [
  'B2_ENDPOINT',
  'B2_REGION',
  'B2_KEY_ID',
  'B2_APPLICATION_KEY',
  'B2_BUCKET_NAME',
] as const;

type VariableB2 = (typeof VARIABLES_B2)[number];

const leer = (config: ConfigService, nombre: VariableB2) =>
  config.get<string>(nombre)?.trim() || undefined;

/** Variables obligatorias de B2 que faltan (o están vacías) en el entorno. */
export function variablesB2Faltantes(config: ConfigService): string[] {
  return VARIABLES_B2.filter((nombre) => !leer(config, nombre));
}

/** Acepta el endpoint con o sin esquema ("s3.us-east-005.backblazeb2.com"). */
function normalizarEndpoint(endpoint: string): string {
  const sinBarra = endpoint.replace(/\/+$/, '');
  return /^https?:\/\//i.test(sinBarra) ? sinBarra : `https://${sinBarra}`;
}

/**
 * Devuelve la configuración de B2, o `null` si falta alguna variable obligatoria
 * (en ese caso el servicio usa el respaldo local en /uploads).
 */
export function cargarConfigB2(config: ConfigService): ConfigB2 | null {
  if (variablesB2Faltantes(config).length > 0) return null;

  return {
    endpoint: normalizarEndpoint(leer(config, 'B2_ENDPOINT')!),
    region: leer(config, 'B2_REGION')!,
    keyId: leer(config, 'B2_KEY_ID')!,
    applicationKey: leer(config, 'B2_APPLICATION_KEY')!,
    bucket: leer(config, 'B2_BUCKET_NAME')!,
  };
}

export function crearClienteB2(config: ConfigB2): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.applicationKey,
    },
    // Las versiones recientes del SDK añaden checksums CRC por defecto en cada
    // petición; B2 no los admite en todas las operaciones, así que se limitan
    // a los casos obligatorios.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/**
 * URL que se guarda en `documentos.ruta` (estilo path: <endpoint>/<bucket>/<clave>).
 * El bucket sigue siendo privado: la descarga se hace a través de
 * GET /documents/:id/download (protegido por JWT). No se guardan URLs firmadas
 * porque caducan. La clave solo contiene caracteres seguros para URL (ver claves.ts).
 */
export function urlObjetoB2(config: ConfigB2, clave: string): string {
  return `${config.endpoint}/${config.bucket}/${clave}`;
}
