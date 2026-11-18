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
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { enParalelo } from '../common/en-paralelo';
import {
  ConfigB2,
  cargarConfigB2,
  crearClienteB2,
  urlObjetoB2,
  variablesB2Faltantes,
} from './b2.config';

/** Contenido listo para enviarse al cliente en una descarga. */
export interface ArchivoDescargable {
  contenido: Readable;
  nombre: string;
  tipo?: string;
  tamano?: number;
}

/** Lo que se guarda en la BD para localizar un archivo almacenado. */
export interface ArchivoAlmacenado {
  /** URL HTTPS del objeto (B2) o ruta local "/uploads/<archivo>". */
  ruta: string;
  /** Clave del objeto en B2, o nombre del archivo en /uploads. */
  nombreGuardado: string;
}

export type ArchivoEnMemoria = Pick<Express.Multer.File, 'buffer' | 'mimetype' | 'size'>;

/** Carpeta del respaldo local (cuando Backblaze B2 no está configurado). */
const CARPETA_LOCAL = 'uploads';

/** Copias/borrados simultáneos contra B2 al mover o eliminar muchos objetos. */
const CONCURRENCIA_B2 = 4;

/**
 * Los documentos guardados en Backblaze B2 tienen en `ruta` una URL HTTPS y en
 * `nombreGuardado` la clave del objeto; los del respaldo local, una ruta local
 * (p. ej. "/uploads/<archivo>.pdf"; los registros antiguos pueden no tener la "/" inicial).
 */
export const estaEnB2 = (archivo: { ruta: string }) => archivo.ruta.startsWith('https://');

/**
 * Comprobación básica de formato de las credenciales de Backblaze B2.
 * Devuelve la lista de problemas encontrados (vacía = credenciales válidas).
 */
function problemasConfigB2(config: ConfigB2): string[] {
  const problemas: string[] = [];
  let host = '';
  try {
    host = new URL(config.endpoint).hostname;
  } catch {
    problemas.push('B2_ENDPOINT no es una URL válida');
  }
  if (host && !host.endsWith('.backblazeb2.com')) {
    problemas.push('B2_ENDPOINT debe ser un endpoint de Backblaze B2 (*.backblazeb2.com)');
  }
  // Región de B2: p. ej. "us-west-004", "us-east-005", "eu-central-003".
  if (!/^[a-z]{2}-[a-z]+-\d{3}$/.test(config.region)) {
    problemas.push('B2_REGION no tiene el formato de una región de B2 (p. ej. "us-east-005")');
  } else if (host && !host.includes(config.region)) {
    problemas.push('B2_REGION no coincide con la región de B2_ENDPOINT');
  }
  if (!/^[A-Za-z0-9]+$/.test(config.keyId)) {
    problemas.push('B2_KEY_ID contiene caracteres no válidos');
  }
  if (/\s/.test(config.applicationKey)) {
    problemas.push('B2_APPLICATION_KEY contiene espacios');
  }
  // Reglas de nombres de bucket de B2: 6-63 caracteres, letras, números y guiones.
  if (!/^[A-Za-z0-9-]{6,63}$/.test(config.bucket)) {
    problemas.push('B2_BUCKET_NAME no es un nombre de bucket válido');
  }
  return problemas;
}

/**
 * Único punto de acceso al almacenamiento de archivos (antes vivía dentro de
 * DocumentsService). Lo comparten documentos y carpetas (renombrado = mover objetos).
 *
 * Interruptor de almacenamiento:
 * - Credenciales de B2 presentes y válidas → Backblaze B2.
 * - Credenciales ausentes, vacías o mal formadas → respaldo local en /uploads
 *   (archivos planos; la jerarquía de carpetas solo existe en la BD).
 */
@Injectable()
export class AlmacenamientoService {
  private readonly logger = new Logger(AlmacenamientoService.name);
  /** `null` = Backblaze B2 no configurado → respaldo local en /uploads. */
  private readonly b2: { config: ConfigB2; cliente: S3Client } | null;

  constructor(private readonly configService: ConfigService) {
    this.b2 = this.inicializarB2();
  }

  get usaB2(): boolean {
    return this.b2 !== null;
  }

  private inicializarB2(): { config: ConfigB2; cliente: S3Client } | null {
    // cargarConfigB2 devuelve null si falta alguna variable o está vacía.
    const config = cargarConfigB2(this.configService);
    if (!config) {
      this.logger.warn(
        `Backblaze B2 no configurado (faltan: ${variablesB2Faltantes(this.configService).join(', ')}). ` +
          `Los documentos se guardarán localmente en /${CARPETA_LOCAL}.`,
      );
      return null;
    }

    const problemas = problemasConfigB2(config);
    if (problemas.length > 0) {
      this.logger.error(
        `Credenciales de Backblaze B2 no válidas (${problemas.join('; ')}). ` +
          `Los documentos se guardarán localmente en /${CARPETA_LOCAL}.`,
      );
      return null;
    }

    this.logger.log(
      `Almacenamiento: Backblaze B2 (bucket "${config.bucket}", región "${config.region}").`,
    );
    return { config, cliente: crearClienteB2(config) };
  }

  private obtenerB2() {
    if (!this.b2) {
      throw new InternalServerErrorException(
        'El documento está en Backblaze B2, pero el almacenamiento B2 no está configurado.',
      );
    }
    return this.b2;
  }

  /* --------------------------- API pública --------------------------- */

  /** URL que se guarda en `documentos.ruta` para una clave de B2. */
  urlB2(clave: string): string {
    return urlObjetoB2(this.obtenerB2().config, clave);
  }

  /**
   * Guarda el archivo (en B2 bajo `clave`, o en /uploads) y devuelve lo que hay que
   * registrar en la BD. Si falla, no deja nada almacenado.
   */
  async guardar(
    clave: string,
    archivo: ArchivoEnMemoria,
    nombreOriginal: string,
  ): Promise<ArchivoAlmacenado> {
    if (this.b2) {
      await this.subirAB2(clave, archivo, nombreOriginal);
      return { ruta: urlObjetoB2(this.b2.config, clave), nombreGuardado: clave };
    }
    const ruta = await this.guardarLocal(clave, archivo);
    return { ruta, nombreGuardado: ruta.split('/').pop()! };
  }

  /** Borra el archivo (B2 o /uploads). Nunca lanza: un huérfano no afecta al usuario. */
  async eliminar(archivo: ArchivoAlmacenado): Promise<void> {
    if (estaEnB2(archivo)) {
      await this.eliminarDeB2(archivo.nombreGuardado);
    } else {
      await this.eliminarLocal(archivo.ruta);
    }
  }

  /** Obtiene el contenido para descargarlo (desde Backblaze B2 o del respaldo local). */
  async obtener(
    archivo: ArchivoAlmacenado & { nombreOriginal: string },
  ): Promise<ArchivoDescargable> {
    if (!estaEnB2(archivo)) {
      const rutaLocal = join(process.cwd(), archivo.ruta);
      const info = await stat(rutaLocal).catch(() => null);
      if (!info) throw new NotFoundException('El archivo del documento ya no existe');
      return {
        contenido: createReadStream(rutaLocal),
        nombre: archivo.nombreOriginal,
        tamano: info.size,
      };
    }

    const { config, cliente } = this.obtenerB2();
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
        `Error descargando "${archivo.nombreGuardado}" de Backblaze B2`,
        err as Error,
      );
      throw new InternalServerErrorException('No se pudo obtener el archivo.');
    }
  }

  /**
   * Copia un objeto dentro del bucket (S3/B2 no tiene "mover": se copia y luego se borra
   * el original). Conserva Content-Type y Content-Disposition. Lanza si falla.
   */
  async copiarEnB2(origen: string, destino: string): Promise<void> {
    const { config, cliente } = this.obtenerB2();
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

  /** Borra varias claves de B2 (best effort, con concurrencia limitada). */
  async eliminarClavesB2(claves: readonly string[]): Promise<void> {
    if (claves.length === 0) return;
    // eliminarDeB2 nunca lanza, así que enParalelo recorre todas las claves.
    await enParalelo(claves, CONCURRENCIA_B2, (clave) => this.eliminarDeB2(clave));
  }

  /* ------------------------- Backblaze B2 -------------------------- */

  private async subirAB2(
    clave: string,
    archivo: ArchivoEnMemoria,
    nombreOriginal: string,
  ): Promise<void> {
    const { config, cliente } = this.obtenerB2();
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
      this.logger.error(`Error subiendo "${clave}" a Backblaze B2`, err as Error);
      throw new InternalServerErrorException(
        'No se pudo almacenar el archivo. Inténtalo de nuevo más tarde.',
      );
    }
  }

  private async eliminarDeB2(clave: string): Promise<void> {
    try {
      const { config, cliente } = this.obtenerB2();
      await cliente.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: clave }));
    } catch (err) {
      // No se relanza: el registro ya no existe y un objeto huérfano no afecta al usuario.
      this.logger.error(`No se pudo borrar "${clave}" de Backblaze B2`, err as Error);
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
