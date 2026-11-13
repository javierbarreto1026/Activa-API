import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ACCIONES_AUDITORIA, type AccionAuditoria } from '../audit-log.entity';
import {
  DEPARTAMENTOS,
  MENSAJE_DEPARTAMENTO_INVALIDO,
  type Departamento,
} from '../../common/departamentos';

/** Query de GET /logs?pagina=1&limite=20&departamento=SST&accion=UPLOAD_DOCUMENT */
export class FiltrosAuditoriaDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite?: number;

  @IsOptional()
  @IsIn(ACCIONES_AUDITORIA)
  accion?: AccionAuditoria;

  @IsOptional()
  @IsIn(DEPARTAMENTOS, { message: MENSAJE_DEPARTAMENTO_INVALIDO })
  departamento?: Departamento;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  usuarioId?: number;
}
