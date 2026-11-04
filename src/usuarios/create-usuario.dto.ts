import { IsString, IsEmpty } from 'class-validator';

export class CreateUsuarioDto {
  correo!: string;
  contrasena!: string;
  nombre!: string;

  @IsString()
  @IsEmpty()
  departamento!: string;
}
