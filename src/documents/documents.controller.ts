import {
  Controller,
  Get,
  Post,
  Param,
  Delete,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { diskStorage } from 'multer';
import { extname } from 'node:path';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  //POST https://localhost:3000/documents/upload

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
  uploadDocument(@UploadedFile() file: Express.Multer.File) {
    return this.documentsService.uploadToCloud(file);
  }

  // GET: http://localhost:3000/documents
  @Get()
  findAll() {
    return this.documentsService.findAll();
  }

  // GET: http://localhost:3000/documents/1
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.documentsService.findOne(id);
  }

  // DELETE: http://localhost:3000/documents/1
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documentsService.remove(id);
  }
}
