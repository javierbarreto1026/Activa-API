import { IsNotEmpty, IsString } from 'class-validator';

/**
 * POST /usuarios/restablecer-contrasena. Aquí solo se garantiza que los tres campos sean
 * textos (bcrypt y las búsquedas por correo fallan con otros tipos). Las reglas de la clave
 * están en politica-contrasena.ts y las aplica el servicio.
 */
export class RestablecerContrasenaDto {
  @IsNotEmpty({ message: 'El correo es obligatorio.' })
  @IsString({ message: 'El correo no es válido.' })
  correo!: string;

  @IsNotEmpty({ message: 'El código de verificación es obligatorio.' })
  @IsString({ message: 'El código de verificación no es válido.' })
  codigo!: string;

  @IsNotEmpty({ message: 'La nueva contraseña es obligatoria.' })
  @IsString({ message: 'La nueva contraseña no es válida.' })
  nuevaContrasena!: string;
}
