import {
  Controller,
  Get,
  Post,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  Body,
  BadRequestException,
  UseFilters,
  Query,
  Res,
  ParseIntPipe,
} from '@nestjs/common';
import { pipeline } from 'node:stream/promises';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import {
  ArchivoMuyGrandeFilter,
  LimiteTamanoLoteInterceptor,
  MAX_ARCHIVOS_POR_LOTE,
  opcionesSubida,
  opcionesSubidaMasiva,
  verificarContenidoArchivo,
} from './upload.config';
import { JwtAuthGuard } from '../usuarios/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsuarioActual } from '../auth/decorators/usuario-actual.decorator';
import { ROLES_ADMIN, type UsuarioSesion } from '../auth/usuario-sesion';
import { validarDto } from '../common/validacion';
import { SubirDocumentoDto } from './dto/subir-documento.dto';
import { SubirCarpetaDto } from './dto/subir-carpeta.dto';

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  // POST /documents/upload   multipart: file, departamento?, carpetaId?, fechaDocumento?
  @Post('upload')
  @UseFilters(ArchivoMuyGrandeFilter)
  @UseInterceptors(FileInterceptor('file', opcionesSubida))
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(validarDto) datos: SubirDocumentoDto,
  ) {
    if (!file) {
      throw new BadRequestException('Debes adjuntar un archivo en el campo "file".');
    }

    // Revisa los bytes reales del archivo (en memoria); si no coinciden con la extensión responde 400.
    verificarContenidoArchivo(file);

    // El archivo solo vive en RAM: si algo falla no queda nada que limpiar en disco,
    // y el servicio se encarga de no dejar objetos huérfanos en Cloudflare R2.
    return this.documentsService.guardarDocumento(file, usuario, datos);
  }

  // POST /documents/upload-carpeta
  // multipart: files (hasta MAX_ARCHIVOS_POR_LOTE), rutas (JSON), departamento?, carpetaId?, fechaDocumento?
  // El navegador divide una carpeta grande en varios lotes; cada lote es una petición.
  @Post('upload-carpeta')
  @UseFilters(ArchivoMuyGrandeFilter)
  @UseInterceptors(
    LimiteTamanoLoteInterceptor, // antes de Multer: rechaza lotes demasiado pesados sin leerlos
    FilesInterceptor('files', MAX_ARCHIVOS_POR_LOTE, opcionesSubidaMasiva),
  )
  uploadCarpeta(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @UsuarioActual() usuario: UsuarioSesion,
    @Body(validarDto) datos: SubirCarpetaDto,
  ) {
    return this.documentsService.guardarCarpeta(files ?? [], usuario, datos);
  }

  // GET /documents  → Administrador: todos. Resto: solo los de su área.
  @Get()
  findAll(@UsuarioActual() usuario: UsuarioSesion) {
    return this.documentsService.findAll(usuario);
  }

  // GET /documents/paginado?pagina=1&limite=6&fechaDesde=2023-01-01&fechaHasta=2023-12-31&carpetaId=4
  // Debe declararse antes de @Get(':id') para que "paginado" no se tome como un id.
  @Get('paginado')
  findAllPaginado(
    @UsuarioActual() usuario: UsuarioSesion,
    @Query('pagina') pagina?: string,
    @Query('limite') limite?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('departamento') departamento?: string,
    @Query('carpetaId') carpetaId?: string,
    @Query('buscar') buscar?: string,
    @Query('orden') orden?: string,
    @Query('direccion') direccion?: string,
  ) {
    const aEntero = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

    return this.documentsService.findAllPaginado(usuario, {
      pagina: aEntero(pagina),
      limite: aEntero(limite),
      fechaDesde: fechaDesde || undefined,
      fechaHasta: fechaHasta || undefined,
      departamento: departamento || undefined,
      carpetaId: aEntero(carpetaId),
      buscar: buscar || undefined,
      orden: orden === 'nombre' ? 'nombre' : 'fecha',
      direccion: direccion?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC',
    });
  }

  // GET /documents/1  (404 si es de otra área y el usuario no es administrador)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: UsuarioSesion) {
    return this.documentsService.findOne(id, usuario);
  }

  @Get(':id/download')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioSesion,
    @Res() res: Response,
  ) {
    // El bucket es privado: el backend lee el objeto de Cloudflare R2 y lo transmite al cliente,
    // así la descarga sigue protegida por el JWT y por el área. Los errores (404/500) los responde Nest.
    const archivo = await this.documentsService.obtenerArchivo(id, usuario);

    res.attachment(archivo.nombre); // Content-Disposition + Content-Type según la extensión
    if (archivo.tipo) res.type(archivo.tipo);
    if (archivo.tamano !== undefined) res.setHeader('Content-Length', archivo.tamano);

    // pipeline cierra ambos streams si el cliente cancela o R2 corta la conexión.
    await pipeline(archivo.contenido, res).catch(() => res.destroy());
  }

  // DELETE /documents/1 (solo administradores)
  @UseGuards(RolesGuard)
  @Roles(...ROLES_ADMIN)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @UsuarioActual() usuario: UsuarioSesion) {
    return this.documentsService.remove(id, usuario);
  }
}
