import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, type AccionAuditoria } from './audit-log.entity';
import type { FiltrosAuditoriaDto } from './dto/filtros-auditoria.dto';

export interface EntradaAuditoria {
  usuarioId: number;
  accion: AccionAuditoria;
  departamento?: string | null;
  detalles?: string | null;
}

/** Límite defensivo para la columna `details` (TEXT admite 64 KB). */
const LONGITUD_MAXIMA_DETALLES = 2000;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepository: Repository<AuditLog>,
  ) {}

  /**
   * Registra una o varias acciones en una sola consulta.
   *
   * Es "best effort": si la escritura del log falla, se informa en el log del
   * servidor pero NO se revierte la operación del usuario (el archivo ya está en
   * R2 y en la BD). Si prefieres que un fallo de auditoría bloquee la operación,
   * basta con relanzar el error en el catch.
   */
  async registrar(entradas: EntradaAuditoria | EntradaAuditoria[]): Promise<void> {
    const lista = Array.isArray(entradas) ? entradas : [entradas];
    if (lista.length === 0) return;

    try {
      await this.auditRepository.insert(
        lista.map((e) => ({
          userId: e.usuarioId,
          action: e.accion,
          department: e.departamento?.slice(0, 50) ?? null,
          details: e.detalles?.slice(0, LONGITUD_MAXIMA_DETALLES) ?? null,
        })),
      );
    } catch (err) {
      this.logger.error(
        `No se pudieron registrar ${lista.length} evento(s) de auditoría (${lista[0].accion})`,
        err as Error,
      );
    }
  }

  /** Historial paginado, del más reciente al más antiguo. */
  async listar(filtros: FiltrosAuditoriaDto = {}) {
    const pagina = Math.max(1, filtros.pagina ?? 1);
    const limite = Math.min(100, Math.max(1, filtros.limite ?? 20));

    const qb = this.auditRepository
      .createQueryBuilder('log')
      // Solo nombre y correo del usuario (nunca su contraseña).
      .leftJoin('log.user', 'usuario')
      .addSelect(['usuario.id', 'usuario.nombre', 'usuario.correo']);

    if (filtros.departamento?.trim()) {
      qb.andWhere('log.department = :departamento', {
        departamento: filtros.departamento.trim(),
      });
    }
    if (filtros.accion) {
      qb.andWhere('log.action = :accion', { accion: filtros.accion });
    }
    if (filtros.usuarioId) {
      qb.andWhere('log.userId = :usuarioId', { usuarioId: filtros.usuarioId });
    }

    qb.orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .offset((pagina - 1) * limite)
      .limit(limite);

    const [registros, total] = await qb.getManyAndCount();

    return {
      data: registros.map((log) => ({
        id: log.id,
        userId: log.userId,
        usuario: log.user?.nombre ?? `Usuario #${log.userId}`,
        correo: log.user?.correo ?? null,
        action: log.action,
        department: log.department,
        details: log.details,
        createdAt: log.createdAt,
      })),
      total,
      pagina,
      limite,
      totalPaginas: Math.max(1, Math.ceil(total / limite)),
    };
  }
}
