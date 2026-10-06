import { Controller, Post, Body } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { CreateUsuarioDto } from './create-usuario.dto';
import { LoginUsuarioDto } from './login-usuario.dto';

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  // --- RUTA 1: REGISTRO ---
  @Post('registro')
  async registrar(@Body() createUsuarioDto: CreateUsuarioDto) {
    const usuarioCreado = await this.usuariosService.crearUsuario(createUsuarioDto);

    return {
      mensaje: 'Usuario creado exitosamente',
      usuario: {
        id: usuarioCreado.id,
        nombre: usuarioCreado.nombre,
        correo: usuarioCreado.correo,
      },
    };
  }

  // --- RUTA 2: LOGIN (Va debajo de registro, dentro de la misma clase) ---
  @Post('login')
  async login(@Body() loginUsuarioDto: LoginUsuarioDto) {
    const usuarioValidado = await this.usuariosService.validarUsuario(loginUsuarioDto);

    return {
      mensaje: 'Inicio de sesión exitoso',
      usuario: usuarioValidado,
    };
  }
} // <-- Esta es la llave final que cierra la clase
