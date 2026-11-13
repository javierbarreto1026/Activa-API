import { Body, Controller, Get, Param, ParseIntPipe, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import { ROLES_ADMIN, type UsuarioSesion } from '../auth/usuario-sesion';
import { validarDto } from '../common/validacion';
import { UpdateUserDto } from './dto/update-user.dto';
import { GestionUsuariosService } from './gestion-usuarios.service';

/**
 * Panel de Gestión de Usuarios. Todo el controlador exige:
 *  1. JwtAuthGuard: token válido y cuenta existente (401 si no).
 *  2. RolesGuard + @Roles: rol Administrador, leído de la BD en cada petición (403 si no).
 */
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ROLES_ADMIN)
export class UsersController {
  constructor(private readonly gestionUsuarios: GestionUsuariosService) {}

  // GET /users
  @Get()
  listar() {
    return this.gestionUsuarios.listar();
  }

  // PATCH /users/5  { "email": "karla@empresa.com", "departamento": "SST" }
  @Patch(':id')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body(validarDto) dto: UpdateUserDto,
    @UsuarioActual() admin: UsuarioSesion,
  ) {
    return this.gestionUsuarios.actualizar(id, dto, admin);
  }
}
