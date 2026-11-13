import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { slug } from '../common/texto';

/**
 * Claves de objeto en Cloudflare R2 con estructura jerárquica legible:
 *
 *   documentos/<area>/<carpeta>/<subcarpeta>/<nombre-del-archivo>-<id>.<ext>
 *   p. ej. documentos/recursos-humanos/contratos-2026/contrato-juan-perez-1a2b3c4d.pdf
 *
 * Cada segmento pasa por `slug()`: sin tildes, espacios ni caracteres especiales, así
 * la clave es segura para URLs y no permite "path traversal". El sufijo aleatorio evita
 * que dos archivos con el mismo nombre en la misma carpeta se sobrescriban.
 * El nombre original exacto se conserva en la BD (documentos.nombreOriginal).
 */
export const RAIZ_DOCUMENTOS = 'documentos';

/** documentos/<area>/<carpeta>/<subcarpeta> */
export function prefijoCarpeta(departamento: string, carpetas: readonly string[]): string {
  return [RAIZ_DOCUMENTOS, slug(departamento), ...carpetas.map((c) => slug(c))].join('/');
}

export function claveDocumento(
  departamento: string,
  carpetas: readonly string[],
  nombreOriginal: string,
): string {
  // La extensión ya pasó por la lista blanca; se filtra igualmente por defensa.
  const ext = extname(nombreOriginal)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '');
  const base = slug(
    nombreOriginal.slice(0, nombreOriginal.length - extname(nombreOriginal).length),
    80,
  );
  const sufijo = randomUUID().slice(0, 8);
  return `${prefijoCarpeta(departamento, carpetas)}/${base}-${sufijo}${ext}`;
}

/**
 * Nueva clave de un objeto existente tras renombrar alguna de sus carpetas:
 * conserva el nombre del archivo (último segmento) y cambia solo el prefijo.
 */
export function reubicarClave(
  claveActual: string,
  departamento: string,
  carpetas: readonly string[],
): string {
  const archivo = claveActual.split('/').pop() || claveActual;
  return `${prefijoCarpeta(departamento, carpetas)}/${archivo}`;
}
