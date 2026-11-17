import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../usuarios/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import { ROLES_ADMIN, type UsuarioSesion } from '../auth/usuario-sesion';
import { validarDto } from '../common/validacion';
import { CrearCarpetaDto } from './dto/crear-carpeta.dto';
import { RenombrarCarpetaDto } from './dto/renombrar-carpeta.dto';
import { FoldersService } from './folders.service';

@Controller('folders')
@UseGuards(JwtAuthGuard)
export class FoldersController {
  constructor(private readonly foldersService: FoldersService) {}

  // GET /folders?departamento=SST
  // Administrador: todas (o las del área indicada). Resto: solo las de su área.
  @Get()
  listar(@UsuarioActual() usuario: UsuarioSesion, @Query('departamento') departamento?: string) {
    return this.foldersService.listar(usuario, departamento);
  }

  // POST /folders  { "nombre": "Contratos", "departamento": "Recursos Humanos" }
  // POST /folders  { "nombre": "2026", "padreId": 4 }
  @Post()
  crear(@Body(validarDto) dto: CrearCarpetaDto, @UsuarioActual() usuario: UsuarioSesion) {
    return this.foldersService.crear(dto, usuario);
  }

  // PATCH /folders/4  { "nombre": "Contratos firmados" }
  @Patch(':id')
  renombrar(
    @Param('id', ParseIntPipe) id: number,
    @Body(validarDto) dto: RenombrarCarpetaDto,
    @UsuarioActual() usuario: UsuarioSesion,
  ) {
    return this.foldersService.renombrar(id, dto, usuario);
  }

  // DELETE /folders/4 (solo administradores, como DELETE /documents/:id: borrar una
  // carpeta borra también sus subcarpetas y documentos, en MySQL y en Cloudflare R2).
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @Delete(':id')
  eliminar(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: UsuarioSesion) {
    return this.foldersService.eliminarCarpeta(id, usuario);
  }
}
