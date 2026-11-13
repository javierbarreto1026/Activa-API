import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { enParalelo } from '../common/en-paralelo';
import {
  ConfigR2,
  cargarConfigR2,
  crearClienteR2,
  urlObjetoR2,
  variablesR2Faltantes,
} from './r2.config';

/** Contenido listo para enviarse al cliente en una descarga. */
export interface ArchivoDescargable {
  contenido: Readable;
  nombre: string;
  tipo?: string;
  tamano?: number;
}

/** Lo que se guarda en la BD para localizar un archivo almacenado. */
export interface ArchivoAlmacenado {
  /** URL HTTPS del objeto (R2) o ruta local "/uploads/<archivo>". */
  ruta: string;
  /** Clave del objeto en R2, o nombre del archivo en /uploads. */
  nombreGuardado: string;
}

export type ArchivoEnMemoria = Pick<Express.Multer.File, 'buffer' | 'mimetype' | 'size'>;

/** Carpeta del respaldo local (cuando Cloudflare R2 no está configurado). */
const CARPETA_LOCAL = 'uploads';

/** Copias/borrados simultáneos contra R2 al mover o eliminar muchos objetos. */
const CONCURRENCIA_R2 = 4;

/**
 * Los documentos guardados en Cloudflare R2 tienen en `ruta` una URL HTTPS y en
 * `nombreGuardado` la clave del objeto; los del respaldo local, una ruta local
 * (p. ej. "/uploads/<archivo>.pdf"; los registros antiguos pueden no tener la "/" inicial).
 */
export const estaEnR2 = (archivo: { ruta: string }) => archivo.ruta.startsWith('https://');

/**
 * Comprobación básica de formato de las credenciales de Cloudflare R2.
 * Devuelve la lista de problemas encontrados (vacía = credenciales válidas).
 * El Account ID forma parte del hostname del endpoint, así que se exige estrictamente
 * su formato (32 caracteres hexadecimales).
 */
function problemasConfigR2(config: ConfigR2): string[] {
  const problemas: string[] = [];
  if (!/^[0-9a-f]{32}$/i.test(config.accountId)) {
    problemas.push('CLOUDFLARE_ACCOUNT_ID debe tener 32 caracteres hexadecimales');
  }
  if (!/^[A-Za-z0-9]+$/.test(config.accessKeyId)) {
    problemas.push('CLOUDFLARE_R2_ACCESS_KEY_ID contiene caracteres no válidos');
  }
  if (!/^[A-Za-z0-9]+$/.test(config.secretAccessKey)) {
    problemas.push('CLOUDFLARE_R2_SECRET_ACCESS_KEY contiene caracteres no válidos');
  }
  // Reglas de nombres de bucket de R2: 3-63 caracteres, minúsculas, números y guiones.
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucket)) {
    problemas.push('CLOUDFLARE_R2_BUCKET_NAME no es un nombre de bucket válido');
  }
  return problemas;
}

/**
 * Único punto de acceso al almacenamiento de archivos (antes vivía dentro de
 * DocumentsService). Lo comparten documentos y carpetas (renombrado = mover objetos).
 *
 * Interruptor de almacenamiento:
 * - Credenciales de R2 presentes y válidas → Cloudflare R2.
 * - Credenciales ausentes, vacías o mal formadas → respaldo local en /uploads
 *   (archivos planos; la jerarquía de carpetas solo existe en la BD).
 */
@Injectable()
export class AlmacenamientoService {
  private readonly logger = new Logger(AlmacenamientoService.name);
  /** `null` = Cloudflare R2 no configurado → respaldo local en /uploads. */
  private readonly r2: { config: ConfigR2; cliente: S3Client } | null;

  constructor() {
    this.r2 = this.inicializarR2();
  }

  get usaR2(): boolean {
    return this.r2 !== null;
  }

  private inicializarR2(): { config: ConfigR2; cliente: S3Client } | null {
    // cargarConfigR2 devuelve null si falta alguna variable o está vacía.
    const config = cargarConfigR2();
    if (!config) {
      this.logger.warn(
        `Cloudflare R2 no configurado (faltan: ${variablesR2Faltantes().join(', ')}). ` +
          `Los documentos se guardarán localmente en /${CARPETA_LOCAL}.`,
      );
      return null;
    }

    const problemas = problemasConfigR2(config);
    if (problemas.length > 0) {
      this.logger.error(
        `Credenciales de Cloudflare R2 no válidas (${problemas.join('; ')}). ` +
          `Los documentos se guardarán localmente en /${CARPETA_LOCAL}.`,
      );
      return null;
    }

    this.logger.log(`Almacenamiento: Cloudflare R2 (bucket "${config.bucket}").`);
    return { config, cliente: crearClienteR2(config) };
  }

  private obtenerR2() {
    if (!this.r2) {
      throw new InternalServerErrorException(
        'El documento está en Cloudflare R2, pero el almacenamiento R2 no está configurado.',
      );
    }
    return this.r2;
  }

  /* --------------------------- API pública --------------------------- */

  /** URL que se guarda en `documentos.ruta` para una clave de R2. */
  urlR2(clave: string): string {
    return urlObjetoR2(this.obtenerR2().config, clave);
  }

  /**
   * Guarda el archivo (en R2 bajo `clave`, o en /uploads) y devuelve lo que hay que
   * registrar en la BD. Si falla, no deja nada almacenado.
   */
  async guardar(
    clave: string,
    archivo: ArchivoEnMemoria,
    nombreOriginal: string,
  ): Promise<ArchivoAlmacenado> {
    if (this.r2) {
      await this.subirAR2(clave, archivo, nombreOriginal);
      return { ruta: urlObjetoR2(this.r2.config, clave), nombreGuardado: clave };
    }
    const ruta = await this.guardarLocal(clave, archivo);
    return { ruta, nombreGuardado: ruta.split('/').pop()! };
  }

  /** Borra el archivo (R2 o /uploads). Nunca lanza: un huérfano no afecta al usuario. */
  async eliminar(archivo: ArchivoAlmacenado): Promise<void> {
    if (estaEnR2(archivo)) {
      await this.eliminarDeR2(archivo.nombreGuardado);
    } else {
      await this.eliminarLocal(archivo.ruta);
    }
  }

  /** Obtiene el contenido para descargarlo (desde Cloudflare R2 o del respaldo local). */
  async obtener(
    archivo: ArchivoAlmacenado & { nombreOriginal: string },
  ): Promise<ArchivoDescargable> {
    if (!estaEnR2(archivo)) {
      const rutaLocal = join(process.cwd(), archivo.ruta);
      const info = await stat(rutaLocal).catch(() => null);
      if (!info) throw new NotFoundException('El archivo del documento ya no existe');
      return {
        contenido: createReadStream(rutaLocal),
        nombre: archivo.nombreOriginal,
        tamano: info.size,
      };
    }

    const { config, cliente } = this.obtenerR2();
    try {
      const respuesta = await cliente.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: archivo.nombreGuardado }),
      );
      return {
        contenido: respuesta.Body as Readable,
        nombre: archivo.nombreOriginal,
        tipo: respuesta.ContentType,
        tamano: respuesta.ContentLength,
      };
    } catch (err) {
      if (err instanceof NoSuchKey) {
        throw new NotFoundException('El archivo del documento ya no existe');
      }
      this.logger.error(
        `Error descargando "${archivo.nombreGuardado}" de Cloudflare R2`,
        err as Error,
      );
      throw new InternalServerErrorException('No se pudo obtener el archivo.');
    }
  }

  /**
   * Copia un objeto dentro del bucket (R2 no tiene "mover": se copia y luego se borra
   * el original). Conserva Content-Type y Content-Disposition. Lanza si falla.
   */
  async copiarEnR2(origen: string, destino: string): Promise<void> {
    const { config, cliente } = this.obtenerR2();
    await cliente.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        Key: destino,
        // CopySource va URL-codificado: "<bucket>/<clave>".
        CopySource: `${config.bucket}/${origen.split('/').map(encodeURIComponent).join('/')}`,
        MetadataDirective: 'COPY',
      }),
    );
  }

  /** Borra varias claves de R2 (best effort, con concurrencia limitada). */
  async eliminarClavesR2(claves: readonly string[]): Promise<void> {
    if (claves.length === 0) return;
    // eliminarDeR2 nunca lanza, así que enParalelo recorre todas las claves.
    await enParalelo(claves, CONCURRENCIA_R2, (clave) => this.eliminarDeR2(clave));
  }

  /* ------------------------- Cloudflare R2 -------------------------- */

  private async subirAR2(
    clave: string,
    archivo: ArchivoEnMemoria,
    nombreOriginal: string,
  ): Promise<void> {
    const { config, cliente } = this.obtenerR2();
    try {
      await cliente.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: clave,
          Body: archivo.buffer, // Multer usa memoryStorage: el archivo nunca toca el disco.
          ContentType: archivo.mimetype,
          ContentLength: archivo.size,
          // Si alguien abre la URL directa, el navegador descarga con el nombre original.
          ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(nombreOriginal)}`,
        }),
      );
    } catch (err) {
      this.logger.error(`Error subiendo "${clave}" a Cloudflare R2`, err as Error);
      throw new InternalServerErrorException(
        'No se pudo almacenar el archivo. Inténtalo de nuevo más tarde.',
      );
    }
  }

  private async eliminarDeR2(clave: string): Promise<void> {
    try {
      const { config, cliente } = this.obtenerR2();
      await cliente.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: clave }));
    } catch (err) {
      // No se relanza: el registro ya no existe y un objeto huérfano no afecta al usuario.
      this.logger.error(`No se pudo borrar "${clave}" de Cloudflare R2`, err as Error);
    }
  }

  /* ------------------------- Respaldo local ------------------------- */

  /**
   * Guarda el buffer en ./uploads/<último segmento de la clave> y devuelve la ruta
   * que se guarda en MySQL: "/uploads/<archivo>".
   */
  private async guardarLocal(clave: string, archivo: ArchivoEnMemoria): Promise<string> {
    // El nombre lo genera el servidor (slug + sufijo aleatorio): es seguro como nombre de archivo.
    const nombre = clave.split('/').pop()!;
    const carpeta = join(process.cwd(), CARPETA_LOCAL);
    try {
      await mkdir(carpeta, { recursive: true });
      await writeFile(join(carpeta, nombre), archivo.buffer);
    } catch (err) {
      this.logger.error(`Error guardando "${nombre}" en /${CARPETA_LOCAL}`, err as Error);
      throw new InternalServerErrorException(
        'No se pudo almacenar el archivo. Inténtalo de nuevo más tarde.',
      );
    }
    return `/${CARPETA_LOCAL}/${nombre}`;
  }

  private async eliminarLocal(ruta: string): Promise<void> {
    await unlink(join(process.cwd(), ruta)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') {
        this.logger.error(`No se pudo borrar el archivo ${ruta}`, err);
      }
    });
  }
}
