import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import {
  DEPARTAMENTOS,
  MENSAJE_DEPARTAMENTO_INVALIDO,
  type Departamento,
} from '../../common/departamentos';

/**
 * Campos de texto de POST /documents/upload (multipart/form-data, junto al campo "file").
 * - departamento: obligatorio para administradores cuando no se indica carpeta. Para el
 *   resto se ignora y se usa siempre el área del usuario.
 * - carpetaId: carpeta destino; el área se toma de la carpeta.
 * - fechaDocumento: 'YYYY-MM-DD' (opcional, para documentos históricos).
 */
export class SubirDocumentoDto {
  /** Exactamente: Contabilidad | Recursos Humanos | SST | Gerencia */
  @IsOptional()
  @IsIn(DEPARTAMENTOS, { message: MENSAJE_DEPARTAMENTO_INVALIDO })
  departamento?: Departamento;

  @IsOptional()
  @IsString()
  fechaDocumento?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  carpetaId?: number;
}
