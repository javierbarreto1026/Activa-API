import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../usuarios/jwt-auth.guard';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import type { UsuarioSesion } from '../auth/usuario-sesion';
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
}
