import { Controller, Post, Body, Get, UseGuards, Request, Param } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { UsuariosService } from './usuarios.service';
import { CreateUsuarioDto } from './create-usuario.dto';
import { LoginUsuarioDto } from './login-usuario.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

interface AuthenticatedRequest extends ExpressRequest {
  user: {
    id: number;
    correo: string;
    rol: string;
  };
}

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

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

  @Post('crear')
  async crearUsuario(
    @Body()
    body: {
      nombre: string;
      correo: string;
      contrasena: string;
      departamento: string;
      rol?: string;
    },
  ) {
    return await this.usuariosService.crearUsuarioPorAdmin(body);
  }

  @Post('login')
  async login(@Body() loginUsuarioDto: LoginUsuarioDto) {
    const usuarioValidado = await this.usuariosService.validarUsuario(loginUsuarioDto);

    return {
      mensaje: 'Inicio de sesión exitoso',
      usuario: usuarioValidado,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('perfil')
  obtenerPerfil(@Request() req: AuthenticatedRequest) {
    return {
      mensaje: '¡Entraste a la zona VIP! Tu token es válido.',
      usuario: req.user,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.usuariosService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usuariosService.findOne(Number(id));
  }
  @Post('solicitar-codigo')
  async solicitarCodigo(@Body('correo') correo: string) {
    return await this.usuariosService.solicitarCodigoRecuperacion(correo);
  }

  // 2. Endpoint para verificar el código y cambiar la clave
  @Post('restablecer-contrasena')
  async restablecerContrasena(
    @Body('correo') correo: string,
    @Body('codigo') codigo: string,
    @Body('nuevaContrasena') nuevaContrasena: string,
  ) {
    return await this.usuariosService.restablecerContrasena(correo, codigo, nuevaContrasena);
  }
}
