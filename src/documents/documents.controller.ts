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
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { diskStorage } from 'multer';
import { extname } from 'node:path';
import { JwtAuthGuard } from '../usuarios/jwt-auth.guard';

interface AuthenticatedRequest extends ExpressRequest {
  user: {
    id: number;
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
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const extension = extname(file.originalname);
          cb(null, `${file.fieldname}-${uniqueSuffix}${extension}`);
        },
      }),
    }),
  )
  uploadDocument(@UploadedFile() file: Express.Multer.File, @Request() req: AuthenticatedRequest) {
    const userId = req.user.id;
    return this.documentsService.guardarDocumento(file, userId);
  }

  // GET: http://localhost:3000/documents
  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.documentsService.findAll();
  }

  // GET: http://localhost:3000/documents/1
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentsService.findOne(id);
  }

  // DELETE: http://localhost:3000/documents/1
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documentsService.remove(id);
  }
}
