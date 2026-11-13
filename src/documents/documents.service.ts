import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { departamentoParaLectura, puedeAcceder, type UsuarioSesion } from '../auth/usuario-sesion';
import { enParalelo } from '../common/en-paralelo';
import type { Carpeta } from '../folders/carpeta.entity';
import { FoldersService, type DestinoSubida } from '../folders/folders.service';
import { AlmacenamientoService, type ArchivoDescargable } from '../storage/almacenamiento.service';
import { claveDocumento } from '../storage/claves';
import { Documento } from './documento.entity';
import type { SubirCarpetaDto } from './dto/subir-carpeta.dto';
import type { SubirDocumentoDto } from './dto/subir-documento.dto';
import { parsearRutas, type RutaRelativa } from './rutas-relativas';
import { LONGITUD_MAXIMA_NOMBRE_ARCHIVO, motivoRechazoArchivo } from './upload.config';

export type { ArchivoDescargable };

/** Fecha efectiva: la asignada por el usuario o, si no tiene, la de registro en el servidor. */
const FECHA_EFECTIVA = 'COALESCE(doc.fecha, doc.fechaSubida)';

const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Archivos de un lote que se suben a R2 a la vez en la carga masiva. */
const SUBIDAS_SIMULTANEAS = 4;

export interface FiltrosDocumentos {
  pagina?: number;
  limite?: number;
  fechaDesde?: string; // 'YYYY-MM-DD'
  fechaHasta?: string; // 'YYYY-MM-DD'
  departamento?: string;
  carpetaId?: number;
  buscar?: string;
  orden?: 'fecha' | 'nombre';
  direccion?: 'ASC' | 'DESC';
}

export interface ArchivoOmitido {
  ruta: string;
  motivo: string;
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

/** Forma pública de un documento (sin rutas internas ni datos del usuario). */
function serializarDocumento(doc: Documento, subidoPor?: string) {
  return {
    id: doc.id,
    nombre: doc.nombreOriginal,
    nombreOriginal: doc.nombreOriginal,
    departamento: doc.departamento,
    carpetaId: doc.carpetaId ?? null,
    usuarioId: doc.usuarioId,
    subidoPor: subidoPor ?? (doc.usuario ? doc.usuario.nombre : `Usuario #${doc.usuarioId}`),
    fecha: doc.fecha ?? doc.fechaSubida,
    fechaSubida: doc.fechaSubida,
  };
}

/** "Contratos / 2026 / contrato.pdf" (sin el área, que va en su propia columna del log). */
const rutaParaLog = (destino: DestinoSubida, archivo: string) =>
  [...destino.segmentos, archivo].join(' / ');

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,
    private readonly almacenamiento: AlmacenamientoService,
    private readonly carpetas: FoldersService,
    private readonly auditoria: AuditService,
  ) {}

  /* ----------------------------- Subidas ----------------------------- */

  /**
   * Sube el archivo a su clave jerárquica (documentos/<area>/<carpetas>/<archivo>)
   * y registra el documento. Si falla la BD, borra el archivo recién subido.
   */
  private async almacenarYRegistrar(
    file: Express.Multer.File,
    nombreOriginal: string,
    destino: DestinoSubida,
    fecha: Date,
    usuarioId: number,
  ): Promise<Documento> {
    const clave = claveDocumento(destino.departamento, destino.segmentos, nombreOriginal);
    const almacenado = await this.almacenamiento.guardar(clave, file, nombreOriginal);

    try {
      const nuevoDoc = this.documentoRepository.create({
        nombreOriginal,
        nombreGuardado: almacenado.nombreGuardado,
        ruta: almacenado.ruta,
        departamento: destino.departamento,
        carpetaId: destino.carpeta?.id ?? null,
        fecha,
        usuarioId,
      });
      return await this.documentoRepository.save(nuevoDoc);
    } catch (err) {
      await this.almacenamiento.eliminar(almacenado);
      throw err;
    }
  }

  /** POST /documents/upload */
  async guardarDocumento(
    file: Express.Multer.File,
    usuario: UsuarioSesion,
    datos: SubirDocumentoDto,
  ) {
    // Todo se valida antes de subir nada, para no dejar archivos huérfanos.
    if (file.originalname.length > LONGITUD_MAXIMA_NOMBRE_ARCHIVO) {
      throw new BadRequestException(
        `El nombre del archivo supera ${LONGITUD_MAXIMA_NOMBRE_ARCHIVO} caracteres.`,
      );
    }
    const fecha = datos.fechaDocumento
      ? parsearFechaLocal(datos.fechaDocumento, 'fechaDocumento')
      : new Date();
    // Control de acceso: un usuario no administrador solo puede subir a su área.
    const destino = await this.carpetas.resolverDestino(
      usuario,
      datos.departamento,
      datos.carpetaId,
    );

    const doc = await this.almacenarYRegistrar(file, file.originalname, destino, fecha, usuario.id);

    await this.auditoria.registrar({
      usuarioId: usuario.id,
      accion: 'UPLOAD_DOCUMENT',
      departamento: destino.departamento,
      detalles: `Subió "${rutaParaLog(destino, doc.nombreOriginal)}" (documento ${doc.id})`,
    });

    return serializarDocumento(doc, usuario.nombre);
  }

  /**
   * POST /documents/upload-carpeta — un lote de la carga masiva.
   *
   * Recrea bajo el destino la jerarquía de carpetas de las rutas relativas (reutiliza
   * las que ya existen, así varios lotes de la misma carpeta convergen en el mismo
   * árbol) y sube los archivos válidos. Los no válidos se omiten y se informan.
   */
  async guardarCarpeta(
    files: Express.Multer.File[],
    usuario: UsuarioSesion,
    datos: SubirCarpetaDto,
  ) {
    if (!files.length) {
      throw new BadRequestException('Debes adjuntar al menos un archivo en el campo "files".');
    }
    const rutas = parsearRutas(datos.rutas, files.length);
    const fecha = datos.fechaDocumento
      ? parsearFechaLocal(datos.fechaDocumento, 'fechaDocumento')
      : new Date();
    const base = await this.carpetas.resolverDestino(usuario, datos.departamento, datos.carpetaId);

    const omitidos: ArchivoOmitido[] = [];
    const validos: { file: Express.Multer.File; ruta: RutaRelativa }[] = [];
    files.forEach((file, i) => {
      const motivo = motivoRechazoArchivo(rutas[i].archivo, file);
      if (motivo) omitidos.push({ ruta: rutas[i].original, motivo });
      else validos.push({ file, ruta: rutas[i] });
    });

    // Carpetas en serie: dos archivos de la misma carpeta no deben crearla dos veces.
    const cache = new Map<string, DestinoSubida>();
    const creadas: Carpeta[] = [];
    const listos: { file: Express.Multer.File; ruta: RutaRelativa; destino: DestinoSubida }[] = [];
    for (const v of validos) {
      try {
        const destino = await this.carpetas.asegurarRuta(
          base,
          v.ruta.carpetas,
          usuario,
          cache,
          creadas,
        );
        listos.push({ ...v, destino });
      } catch (err) {
        omitidos.push({
          ruta: v.ruta.original,
          motivo: err instanceof HttpException ? err.message : 'No se pudo crear la carpeta.',
        });
      }
    }

    const subidos: { doc: Documento; destino: DestinoSubida }[] = [];
    await enParalelo(listos, SUBIDAS_SIMULTANEAS, async ({ file, ruta, destino }) => {
      try {
        const doc = await this.almacenarYRegistrar(file, ruta.archivo, destino, fecha, usuario.id);
        subidos.push({ doc, destino });
      } catch (err) {
        this.logger.error(`Carga masiva: no se pudo guardar "${ruta.original}"`, err as Error);
        omitidos.push({ ruta: ruta.original, motivo: 'No se pudo almacenar el archivo.' });
      }
    });

    await this.auditoria.registrar(
      subidos.map(({ doc, destino }) => ({
        usuarioId: usuario.id,
        accion: 'UPLOAD_DOCUMENT' as const,
        departamento: destino.departamento,
        detalles:
          `Subió "${rutaParaLog(destino, doc.nombreOriginal)}" (documento ${doc.id}) ` +
          'mediante carga de carpeta',
      })),
    );

    return {
      subidos: subidos.length,
      carpetasCreadas: creadas.length,
      omitidos,
      documentos: subidos.map(({ doc }) => serializarDocumento(doc, usuario.nombre)),
    };
  }

  /* ---------------------------- Consultas ---------------------------- */

  /**
   * Todos los documentos visibles para el usuario.
   * Administrador: todos. Resto: solo los de su área.
   */
  async findAll(usuario: UsuarioSesion) {
    const departamento = departamentoParaLectura(usuario);

    const qb = this.documentoRepository
      .createQueryBuilder('doc')
      // Solo se trae el nombre del usuario (nunca su contraseña ni otros datos).
      .leftJoin('doc.usuario', 'usuario')
      .addSelect(['usuario.id', 'usuario.nombre'])
      .orderBy('doc.id', 'DESC');

    if (departamento) {
      qb.where('doc.departamento = :departamento', { departamento });
    }

    return (await qb.getMany()).map((doc) => serializarDocumento(doc));
  }

  /**
   * Listado paginado con filtros (restringido al área del usuario si no es administrador).
   * Los rangos de fechas y el orden usan la fecha efectiva del documento:
   * COALESCE(doc.fecha, doc.fechaSubida).
   */
  async findAllPaginado(usuario: UsuarioSesion, filtros: FiltrosDocumentos = {}) {
    const pagina = Math.max(1, Math.floor(filtros.pagina ?? 1));
    const limite = Math.min(50, Math.max(1, Math.floor(filtros.limite ?? 6)));
    const direccion = filtros.direccion === 'ASC' ? 'ASC' : 'DESC';
    const departamento = departamentoParaLectura(usuario, filtros.departamento);

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
    if (departamento) {
      qb.andWhere('doc.departamento = :departamento', { departamento });
    }
    if (filtros.carpetaId) {
      qb.andWhere('doc.carpetaId = :carpetaId', { carpetaId: filtros.carpetaId });
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
      data: documentos.map((doc) => serializarDocumento(doc)),
      total,
      pagina,
      limite,
      totalPaginas: Math.max(1, Math.ceil(total / limite)),
    };
  }

  /**
   * Documento visible para el usuario. Responde 404 (y no 403) si es de otra área,
   * para no revelar qué documentos existen en otros departamentos.
   */
  async findOne(id: number, usuario: UsuarioSesion): Promise<Documento> {
    const doc = await this.documentoRepository.findOne({ where: { id } });
    if (!doc || !puedeAcceder(usuario, doc.departamento)) {
      throw new NotFoundException('Documento no encontrado');
    }
    return doc;
  }

  /** Obtiene el contenido del documento (desde Cloudflare R2 o del respaldo local). */
  async obtenerArchivo(id: number, usuario: UsuarioSesion): Promise<ArchivoDescargable> {
    const doc = await this.findOne(id, usuario);
    return this.almacenamiento.obtener(doc);
  }

  /* ----------------------------- Borrado ----------------------------- */

  async remove(id: number, usuario: UsuarioSesion) {
    const doc = await this.findOne(id, usuario);

    await this.documentoRepository.delete(doc.id);

    // Borra también el archivo para no acumular espacio (Cloudflare R2 o /uploads).
    await this.almacenamiento.eliminar(doc);

    await this.auditoria.registrar({
      usuarioId: usuario.id,
      accion: 'DELETE_DOCUMENT',
      departamento: doc.departamento,
      detalles: `Eliminó "${doc.nombreOriginal}" (documento ${doc.id})`,
    });

    return { mensaje: `Documento con id ${id} eliminado correctamente` };
  }
}
