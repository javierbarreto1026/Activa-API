import {
  Controller,
  Get,
  Post,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Request,
  Body,
  UnauthorizedException,
  BadRequestException,
  UseFilters,
  Query,
  Res,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { pipeline } from 'node:stream/promises';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { ArchivoMuyGrandeFilter, opcionesSubida, verificarContenidoArchivo } from './upload.config';
import { JwtAuthGuard } from '../usuarios/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { Response } from 'express';

interface AuthenticatedRequest extends ExpressRequest {
  user: {
    id: number;
    sub?: number;
    correo: string;
    rol: string;
  };
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // POST http://localhost:3000/documents/upload
  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseFilters(ArchivoMuyGrandeFilter)
  @UseInterceptors(FileInterceptor('file', opcionesSubida))
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Request() req: AuthenticatedRequest,
    @Body('departamento') departamento: string,
    @Body('fechaDocumento') fechaDocumento?: string,
  ) {
    if (!file) {
      throw new BadRequestException('Debes adjuntar un archivo en el campo "file".');
    }

    const userId = req.user.id || req.user.sub;
    if (!userId) {
      throw new UnauthorizedException('Usuario no válido o sesión expirada');
    }

    // Revisa los bytes reales del archivo (en memoria); si no coinciden con la extensión responde 400.
    verificarContenidoArchivo(file);

    // El archivo solo vive en RAM: si algo falla no queda nada que limpiar en disco,
    // y el servicio se encarga de no dejar objetos huérfanos en Cloudflare R2.
    return this.documentsService.guardarDocumento(file, userId, departamento, fechaDocumento);
  }

  // GET: http://localhost:3000/documents
  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.documentsService.findAll();
  }

  // GET: http://localhost:3000/documents/paginado?pagina=1&limite=6&fechaDesde=2023-01-01&fechaHasta=2023-12-31
  // Debe declararse antes de @Get(':id') para que "paginado" no se tome como un id.
  @UseGuards(JwtAuthGuard)
  @Get('paginado')
  findAllPaginado(
    @Query('pagina') pagina?: string,
    @Query('limite') limite?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('departamento') departamento?: string,
    @Query('buscar') buscar?: string,
    @Query('orden') orden?: string,
    @Query('direccion') direccion?: string,
  ) {
    const aEntero = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

    return this.documentsService.findAllPaginado({
      pagina: aEntero(pagina),
      limite: aEntero(limite),
      fechaDesde: fechaDesde || undefined,
      fechaHasta: fechaHasta || undefined,
      departamento: departamento || undefined,
      buscar: buscar || undefined,
      orden: orden === 'nombre' ? 'nombre' : 'fecha',
      direccion: direccion?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC',
    });
  }

  // GET: http://localhost:3000/documents/1
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    // El bucket es privado: el backend lee el objeto de Cloudflare R2 y lo transmite al cliente,
    // así la descarga sigue protegida por el JWT. Los errores (404/500) los responde Nest.
    const archivo = await this.documentsService.obtenerArchivo(id);

    res.attachment(archivo.nombre); // Content-Disposition + Content-Type según la extensión
    if (archivo.tipo) res.type(archivo.tipo);
    if (archivo.tamano !== undefined) res.setHeader('Content-Length', archivo.tamano);

    // pipeline cierra ambos streams si el cliente cancela o R2 corta la conexión.
    await pipeline(archivo.contenido, res).catch(() => res.destroy());
  }

  // DELETE: http://localhost:3000/documents/1 (Protegido por Roles)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'administrador')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documentsService.remove(id);
  }
}
