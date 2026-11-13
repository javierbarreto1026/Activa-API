import { Transform } from 'class-transformer';
import { IsEmail, IsIn, MaxLength, ValidateIf } from 'class-validator';
import {
  DEPARTAMENTOS,
  MENSAJE_DEPARTAMENTO_INVALIDO,
  type Departamento,
} from '../../common/departamentos';

const recortar = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const aMinusculas = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// Como @IsOptional, pero null NO cuenta como "no enviado": {"email": null} → 400
// (MariaDB sin modo estricto guardaría una cadena vacía en una columna NOT NULL).
const seEnvio = (_: unknown, valor: unknown) => valor !== undefined;

/**
 * PATCH /users/:id — ambos campos son opcionales, pero el servicio exige al menos uno.
 * Con validarDto (whitelist) cualquier otro campo (rol, contrasena…) se descarta.
 */
export class UpdateUserDto {
  @ValidateIf(seEnvio)
  @Transform(aMinusculas)
  @IsEmail({}, { message: 'El correo no tiene un formato válido.' })
  @MaxLength(100, { message: 'El correo no puede superar los 100 caracteres.' })
  email?: string;

  // Coincidencia exacta con una de las 4 áreas oficiales ("sst" o "Producción" → 400).
  @ValidateIf(seEnvio)
  @Transform(recortar)
  @IsIn(DEPARTAMENTOS, { message: MENSAJE_DEPARTAMENTO_INVALIDO })
  departamento?: Departamento;
}
