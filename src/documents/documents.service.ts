import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Documento } from './documento.entity';
import { ConfigR2, cargarConfigR2, urlObjetoR2, variablesR2Faltantes } from './r2.config';

/** Contenido listo para enviarse al cliente en una descarga. */
export interface ArchivoDescargable {
  contenido: Readable;
  nombre: string;
  tipo?: string;
  tamano?: number;
}

/** Carpeta del respaldo local (cuando Cloudflare R2 no está configurado). */
const CARPETA_LOCAL = 'uploads';

/**
 * Los documentos guardados en Cloudflare R2 tienen en `ruta` una URL HTTPS y en
 * `nombreGuardado` la clave del objeto; los del respaldo local, una ruta local
 * (p. ej. "/uploads/<uuid>.pdf"; los registros antiguos pueden no tener la "/" inicial).
 */
const estaEnR2 = (doc: Documento) => doc.ruta.startsWith('https://');

/** Fecha efectiva: la asignada por el usuario o, si no tiene, la de registro en el servidor. */
const FECHA_EFECTIVA = 'COALESCE(doc.fecha, doc.fechaSubida)';

const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

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

export interface FiltrosDocumentos {
  pagina?: number;
  limite?: number;
  fechaDesde?: string; // 'YYYY-MM-DD'
  fechaHasta?: string; // 'YYYY-MM-DD'
  departamento?: string;
  buscar?: string;
  orden?: 'fecha' | 'nombre';
  direccion?: 'ASC' | 'DESC';
}

/**
 * Convierte 'YYYY-MM-DD' en un Date a medianoche LOCAL.
 * (new Date('2023-05-10') lo interpreta como UTC y en Colombia daría el 9 de mayo).
 */
function parsearFechaLocal(valor: string, campo: string): Date {
  const m = FORMATO_FECHA.exec(valor.trim());
  const fecha = m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;

  // La comprobación de mes/día descarta fechas imposibles como 2023-02-31.
  if (!m || !fecha || fecha.getMonth() !== +m[2] - 1 || fecha.getDate() !== +m[3]) {
    throw new BadRequestException(`${campo} no es una fecha válida. Usa el formato AAAA-MM-DD.`);
  }
  return fecha;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  /** `null` = Cloudflare R2 no configurado → respaldo local en /uploads. */
  private readonly r2: { config: ConfigR2; cliente: S3Client } | null;

  constructor(
    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,
  ) {
    this.r2 = this.inicializarR2();
  }

  /**
   * Interruptor de almacenamiento:
   * - Credenciales de R2 presentes y válidas → cliente S3 apuntando a Cloudflare R2.
   * - Credenciales ausentes, vacías o mal formadas → `null` (respaldo local en /uploads).
   */
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

    const cliente = new S3Client({
      region: 'auto', // R2 no usa regiones; Cloudflare exige 'auto'.
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // Las versiones recientes del SDK añaden checksums CRC por defecto en cada
      // petición; se limitan a los casos obligatorios para máxima compatibilidad con R2.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    this.logger.log(`Almacenamiento: Cloudflare R2 (bucket "${config.bucket}").`);
    return { config, cliente };
  }

  /* ------------------------- Cloudflare R2 -------------------------- */

  private obtenerR2() {
    if (!this.r2) {
      throw new InternalServerErrorException(
        'El documento está en Cloudflare R2, pero el almacenamiento R2 no está configurado.',
      );
    }
    return this.r2;
  }

  /** Clave única e impredecible, agrupada por año/mes: documentos/2026/11/<uuid>.pdf */
  private generarClave(nombreOriginal: string): string {
    const ahora = new Date();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    return `documentos/${ahora.getFullYear()}/${mes}/${randomUUID()}${extname(nombreOriginal).toLowerCase()}`;
  }

  private async subirAR2(clave: string, file: Express.Multer.File): Promise<string> {
    const { config, cliente } = this.obtenerR2();
    try {
      await cliente.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: clave,
          Body: file.buffer, // Multer usa memoryStorage: el archivo nunca toca el disco.
          ContentType: file.mimetype,
          ContentLength: file.size,
          // Si alguien abre la URL directa, el navegador descarga con el nombre original.
          ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.originalname)}`,
        }),
      );
    } catch (err) {
      this.logger.error(`Error subiendo "${clave}" a Cloudflare R2`, err as Error);
      throw new InternalServerErrorException(
        'No se pudo almacenar el archivo. Inténtalo de nuevo más tarde.',
      );
    }
    return urlObjetoR2(config, clave);
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
   * Guarda el buffer en ./uploads/<uuid>.<ext> y devuelve la ruta que se guarda
   * en MySQL: "/uploads/<uuid>.<ext>".
   */
  private async guardarLocal(clave: string, file: Express.Multer.File): Promise<string> {
    // El nombre lo genera el servidor (uuid): el nombre original nunca forma parte de la ruta.
    const nombre = clave.split('/').pop()!;
    const carpeta = join(process.cwd(), CARPETA_LOCAL);
    try {
      await mkdir(carpeta, { recursive: true });
      await writeFile(join(carpeta, nombre), file.buffer);
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

  /* --------------------------- Documentos --------------------------- */

  async guardarDocumento(
    file: Express.Multer.File,
    userId: number,
    departamento: string,
    fechaDocumento?: string,
  ) {
    // Se valida antes de subir nada, para no dejar archivos huérfanos.
    const fecha = fechaDocumento ? parsearFechaLocal(fechaDocumento, 'fechaDocumento') : new Date();

    // Interruptor: Cloudflare R2 si está configurado; si no, carpeta local /uploads.
    const clave = this.generarClave(file.originalname);
    const ruta = this.r2 ? await this.subirAR2(clave, file) : await this.guardarLocal(clave, file);

    const hasCloudflareCredentials =
      process.env.CLOUDFLARE_ACCOUNT_ID &&
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

    console.log('¿Tiene credenciales de Cloudflare?', Boolean(hasCloudflareCredentials));
    console.log('Account ID detectado:', process.env.CLOUDFLARE_ACCOUNT_ID);

    try {
      const nuevoDoc = this.documentoRepository.create({
        nombreOriginal: file.originalname,
        nombreGuardado: this.r2 ? clave : ruta.split('/').pop()!,
        ruta,
        departamento,
        fecha,
        usuarioId: userId,
      });
      return await this.documentoRepository.save(nuevoDoc);
    } catch (err) {
      // 🔍 AQUÍ MOSTRAMOS EL ERROR REAL DE CLOUDFLARE SI LLEGA A FALLAR
      console.error('DETALLE DEL ERROR EN LA SUBIDA:', err);

      // Si falla la base de datos, se borra el archivo recién subido.
      await (this.r2 ? this.eliminarDeR2(clave) : this.eliminarLocal(ruta));
      throw err;
    }
  }

  /** Obtiene el contenido del documento (desde Cloudflare R2 o del respaldo local). */
  async obtenerArchivo(id: string): Promise<ArchivoDescargable> {
    const doc = await this.findOne(id);
    if (!doc) {
      throw new NotFoundException('Documento no encontrado');
    }

    if (!estaEnR2(doc)) {
      const rutaLocal = join(process.cwd(), doc.ruta);
      const info = await stat(rutaLocal).catch(() => null);
      if (!info) throw new NotFoundException('El archivo del documento ya no existe');
      return {
        contenido: createReadStream(rutaLocal),
        nombre: doc.nombreOriginal,
        tamano: info.size,
      };
    }

    const { config, cliente } = this.obtenerR2();
    try {
      const respuesta = await cliente.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: doc.nombreGuardado }),
      );
      return {
        contenido: respuesta.Body as Readable,
        nombre: doc.nombreOriginal,
        tipo: respuesta.ContentType,
        tamano: respuesta.ContentLength,
      };
    } catch (err) {
      if (err instanceof NoSuchKey) {
        throw new NotFoundException('El archivo del documento ya no existe');
      }
      this.logger.error(`Error descargando "${doc.nombreGuardado}" de Cloudflare R2`, err as Error);
      throw new InternalServerErrorException('No se pudo obtener el archivo.');
    }
  }

  async findAll() {
    const documentos = await this.documentoRepository.find({
      relations: { usuario: true },
      order: { id: 'DESC' },
    });

    return documentos.map((doc) => ({
      ...doc,
      nombre: doc.nombreOriginal,
      subidoPor: doc.usuario ? doc.usuario.nombre : `Usuario #${doc.usuarioId}`,
      fecha: doc.fecha ?? doc.fechaSubida,
    }));
  }

  /**
   * Listado paginado con filtros. Los rangos de fechas y el orden usan la fecha
   * efectiva del documento: COALESCE(doc.fecha, doc.fechaSubida).
   */
  async findAllPaginado(filtros: FiltrosDocumentos = {}) {
    const pagina = Math.max(1, Math.floor(filtros.pagina ?? 1));
    const limite = Math.min(50, Math.max(1, Math.floor(filtros.limite ?? 6)));
    const direccion = filtros.direccion === 'ASC' ? 'ASC' : 'DESC';

    const qb = this.documentoRepository
      .createQueryBuilder('doc')
      // Solo se trae el nombre del usuario (nunca su contraseña ni otros datos).
      .leftJoin('doc.usuario', 'usuario')
      .addSelect(['usuario.id', 'usuario.nombre']);

    if (filtros.fechaDesde) {
      parsearFechaLocal(filtros.fechaDesde, 'fechaDesde');
      qb.andWhere(`DATE(${FECHA_EFECTIVA}) >= :fechaDesde`, { fechaDesde: filtros.fechaDesde });
    }
    if (filtros.fechaHasta) {
      parsearFechaLocal(filtros.fechaHasta, 'fechaHasta');
      qb.andWhere(`DATE(${FECHA_EFECTIVA}) <= :fechaHasta`, { fechaHasta: filtros.fechaHasta });
    }
    if (filtros.departamento) {
      qb.andWhere('doc.departamento = :departamento', { departamento: filtros.departamento });
    }
    if (filtros.buscar && filtros.buscar.trim()) {
      qb.andWhere('doc.nombreOriginal LIKE :buscar', { buscar: `%${filtros.buscar.trim()}%` });
    }

    if (filtros.orden === 'nombre') {
      qb.orderBy('doc.nombreOriginal', direccion);
    } else {
      qb.orderBy(FECHA_EFECTIVA, direccion);
    }
    // Desempate estable para que la paginación no repita ni salte registros.
    qb.addOrderBy('doc.id', direccion);

    // ManyToOne no duplica filas, así que offset/limit es seguro y evita la
    // subconsulta DISTINCT que genera skip/take (incompatible con ORDER BY sobre expresiones).
    qb.offset((pagina - 1) * limite).limit(limite);

    const [documentos, total] = await qb.getManyAndCount();

    return {
      data: documentos.map((doc) => ({
        id: doc.id,
        nombre: doc.nombreOriginal,
        departamento: doc.departamento,
        subidoPor: doc.usuario ? doc.usuario.nombre : `Usuario #${doc.usuarioId}`,
        fecha: doc.fecha ?? doc.fechaSubida,
        fechaSubida: doc.fechaSubida,
      })),
      total,
      pagina,
      limite,
      totalPaginas: Math.max(1, Math.ceil(total / limite)),
    };
  }

  async findOne(id: string) {
    return await this.documentoRepository.findOne({ where: { id: Number(id) } });
  }

  async remove(id: string) {
    const doc = await this.findOne(id);
    if (!doc) {
      throw new NotFoundException(`No existe un documento con id ${id}`);
    }

    await this.documentoRepository.delete(doc.id);

    // Borra también el archivo para no acumular espacio (Cloudflare R2 o /uploads).
    if (estaEnR2(doc)) {
      await this.eliminarDeR2(doc.nombreGuardado);
    } else {
      await this.eliminarLocal(doc.ruta);
    }

    return { mensaje: `Documento con id ${id} eliminado correctamente` };
  }
}
