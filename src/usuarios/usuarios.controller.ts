import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  UseGuards,
  Request,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { UsuariosService } from './usuarios.service';
import { CreateUsuarioDto } from './create-usuario.dto';
import { LoginUsuarioDto } from './login-usuario.dto';
import { RestablecerContrasenaDto } from './dto/restablecer-contrasena.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import { ROLES_ADMIN, type UsuarioSesion } from '../auth/usuario-sesion';
import { validarDto } from '../common/validacion';

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

  // Solo administradores: sin esta protección cualquiera podía crearse una cuenta
  // de Administrador y saltarse el control de acceso de /users, /logs, etc.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN)
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

  // La lista de usuarios es solo para administradores (el panel usa GET /users).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN)
  @Get()
  findAll() {
    return this.usuariosService.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usuariosService.findOne(Number(id));
  }

  // DELETE /usuarios/5 → baja del empleado (borrado lógico, ver UsuariosService.eliminarUsuario).
  // El id del administrador se toma de la sesión, no del cuerpo de la petición.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ROLES_ADMIN)
  @Delete(':id')
  eliminar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() admin: UsuarioSesion) {
    return this.usuariosService.eliminarUsuario(id, admin.id);
  }

  @Post('solicitar-codigo')
  async solicitarCodigo(@Body('correo') correo: string) {
    return await this.usuariosService.solicitarCodigoRecuperacion(correo);
  }

  // 2. Endpoint para verificar el código y cambiar la clave
  @Post('restablecer-contrasena')
  async restablecerContrasena(@Body(validarDto) dto: RestablecerContrasenaDto) {
    return await this.usuariosService.restablecerContrasena(
      dto.correo,
      dto.codigo,
      dto.nuevaContrasena,
    );
  }
}
