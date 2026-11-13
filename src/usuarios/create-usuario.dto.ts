import { IsIn } from 'class-validator';
import { DEPARTAMENTOS, MENSAJE_DEPARTAMENTO_INVALIDO } from '../common/departamentos';

export class CreateUsuarioDto {
  correo!: string;
  contrasena!: string;
  nombre!: string;

  // Antes tenía @IsEmpty(), que exigía un departamento VACÍO. No fallaba solo porque
  // no hay un ValidationPipe global; el servicio valida el área de todas formas.
  @IsIn(DEPARTAMENTOS, { message: MENSAJE_DEPARTAMENTO_INVALIDO })
  departamento!: string;
}
