// src/usuarios/login-usuario.dto.ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginUsuarioDto {
  @IsEmail()
  correo!: string;

  @IsString()
  @MinLength(6)
  contrasena!: string;
}
