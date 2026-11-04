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
import { join } from 'path';
import { unlink } from 'node:fs/promises';
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
      await unlink(file.path).catch(() => undefined);
      throw new UnauthorizedException('Usuario no válido o sesión expirada');
    }

    // Revisa los bytes reales del archivo; si no coinciden con la extensión lo borra y responde 400.
    await verificarContenidoArchivo(file);

    try {
      return await this.documentsService.guardarDocumento(
        file,
        userId,
        departamento,
        fechaDocumento,
      );
    } catch (err) {
      // Fecha inválida o error de BD: no dejar el archivo huérfano en /uploads.
      await unlink(file.path).catch(() => undefined);
      throw err;
    }
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
    const doc = await this.documentsService.findOne(id);
    if (!doc) {
      return res.status(404).json({ mensaje: 'Documento no encontrado' });
    }

    const rutaAbsoluta = join(process.cwd(), doc.ruta);
    return res.download(rutaAbsoluta, doc.nombreOriginal);
  }

  // DELETE: http://localhost:3000/documents/1 (Protegido por Roles)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'administrador')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documentsService.remove(id);
  }
}
