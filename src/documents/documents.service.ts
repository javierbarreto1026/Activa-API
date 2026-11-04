import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Documento } from './documento.entity';

/** Fecha efectiva: la asignada por el usuario o, si no tiene, la de registro en el servidor. */
const FECHA_EFECTIVA = 'COALESCE(doc.fecha, doc.fechaSubida)';

const FORMATO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

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
  constructor(
    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,
  ) {}

  async guardarDocumento(
    file: Express.Multer.File,
    userId: number,
    departamento: string = 'GENERAL',
    fechaDocumento?: string,
  ) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    let fecha = hoy;
    if (fechaDocumento && fechaDocumento.trim()) {
      fecha = parsearFechaLocal(fechaDocumento, 'La fecha del documento');
      if (fecha > hoy) {
        throw new BadRequestException('La fecha del documento no puede ser posterior a hoy.');
      }
      if (fecha.getFullYear() < 1900) {
        throw new BadRequestException('La fecha del documento no puede ser anterior a 1900.');
      }
    }

    const nuevoDocumento = this.documentoRepository.create({
      nombreOriginal: file.originalname,
      nombreGuardado: file.filename,
      ruta: file.path,
      usuarioId: userId,
      departamento,
      fecha,
    });

    return await this.documentoRepository.save(nuevoDocumento);
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

    // Borra también el archivo físico de /uploads para no acumular espacio.
    await unlink(join(process.cwd(), doc.ruta)).catch((err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') console.error(`No se pudo borrar el archivo ${doc.ruta}:`, err);
    });

    return { mensaje: `Documento con id ${id} eliminado correctamente` };
  }
}
