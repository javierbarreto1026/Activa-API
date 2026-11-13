import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import {
  DEPARTAMENTOS,
  MENSAJE_DEPARTAMENTO_INVALIDO,
  type Departamento,
} from '../../common/departamentos';

/**
 * POST /folders
 * - En la raíz de un área: { nombre, departamento }  (los no administradores pueden
 *   omitir `departamento`: siempre se usa el suyo).
 * - Como subcarpeta:       { nombre, padreId }       (el área se hereda del padre).
 */
export class CrearCarpetaDto {
  @IsString()
  @MaxLength(100)
  nombre!: string;

  /** Exactamente: Contabilidad | Recursos Humanos | SST | Gerencia */
  @IsOptional()
  @IsIn(DEPARTAMENTOS, { message: MENSAJE_DEPARTAMENTO_INVALIDO })
  departamento?: Departamento;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  padreId?: number;
}
