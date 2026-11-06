import { S3Client } from '@aws-sdk/client-s3';

/**
 * Configuración de Cloudflare R2 Object Storage.
 *
 * R2 implementa la API de S3, por eso se usa el cliente de '@aws-sdk/client-s3',
 * pero siempre apuntando al endpoint de Cloudflare:
 *   https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com
 */
export interface ConfigR2 {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  /** Dominio público opcional del bucket (r2.dev o dominio propio), sin "/" final. */
  urlPublica?: string;
}

const VARIABLES_OBLIGATORIAS = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_R2_ACCESS_KEY_ID',
  'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
  'CLOUDFLARE_R2_BUCKET_NAME',
] as const;

const leer = (nombre: string) => process.env[nombre]?.trim() || undefined;

/** Variables obligatorias de R2 que faltan en el entorno. */
export function variablesR2Faltantes(): string[] {
  return VARIABLES_OBLIGATORIAS.filter((nombre) => !leer(nombre));
}

/**
 * Devuelve la configuración de R2, o `null` si falta alguna variable obligatoria
 * (en ese caso el servicio usa el respaldo local en /uploads).
 */
export function cargarConfigR2(): ConfigR2 | null {
  if (variablesR2Faltantes().length > 0) return null;

  const accountId = leer('CLOUDFLARE_ACCOUNT_ID')!;
  return {
    accountId,
    accessKeyId: leer('CLOUDFLARE_R2_ACCESS_KEY_ID')!,
    secretAccessKey: leer('CLOUDFLARE_R2_SECRET_ACCESS_KEY')!,
    bucket: leer('CLOUDFLARE_R2_BUCKET_NAME')!,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    urlPublica: leer('CLOUDFLARE_R2_PUBLIC_URL')?.replace(/\/+$/, ''),
  };
}

export function crearClienteR2(config: ConfigR2): S3Client {
  return new S3Client({
    region: 'auto', // R2 no usa regiones; Cloudflare exige 'auto'.
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // Las versiones recientes del SDK añaden checksums CRC por defecto en cada
    // petición; se limitan a los casos obligatorios para máxima compatibilidad con R2.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

/**
 * URL que se guarda en `documentos.ruta`.
 * - Con CLOUDFLARE_R2_PUBLIC_URL: URL pública del objeto (bucket con acceso público).
 * - Sin ella: URL del objeto en el endpoint de R2. El bucket sigue siendo privado y la
 *   descarga se hace a través de GET /documents/:id/download (protegido por JWT).
 * No se guardan URLs firmadas porque caducan (máximo 7 días).
 * La clave solo contiene caracteres seguros para URL (ver generarClave).
 */
export function urlObjetoR2(config: ConfigR2, clave: string): string {
  return config.urlPublica
    ? `${config.urlPublica}/${clave}`
    : `${config.endpoint}/${config.bucket}/${clave}`;
}
