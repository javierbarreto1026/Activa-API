import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DocumentsService {
  //Definir la ruta de la carpeta de los archivos
  private readonly uploadPath = './uploads';

  uploadToCloud(file: Express.Multer.File) {
    // Si no viene archivo, podemos avisar
    if (!file) {
      return { error: 'No se recibió ningún archivo escaneado' };
    }

    // Aquí irá tu lógica futura para subir a Google Drive u otra nube
    return {
      message: 'Archivo escaneado recibido y listo para procesar',
      filename: file.originalname,
      size: file.size,
      mimetype: file.mimetype,
    };
  }

  //  findAll() {

  //   return 'Aquí se devolverá la lista de todos los documentos escaneados';

  // }

  // findOne(id: number) {

  //   return `Aquí se devolverá la información del documento #${id}`;

  //}

  //remove(id: number) {

  //  return `Aquí se eliminará el documento #${id} de la base de datos y de la nube`;

  //}

  // }

  findAll() {
    try {
      if (!fs.existsSync(this.uploadPath)) {
        return { total: 0, documents: [] };
      }
      const files = fs.readdirSync(this.uploadPath);
      return {
        total: files.length,
        documents: files,
      };
    } catch {
      return { error: 'No se pudo leer la carpeta de archivos' };
    }
  }

  // GET :id : Modificado para buscar si un archivo específico existe por su nombre
  findOne(filename: string) {
    const filePath = path.join(this.uploadPath, filename);
    if (fs.existsSync(filePath)) {
      return { message: 'El documento existe', filename, path: filePath };
    }
    throw new NotFoundException('Documento no encontrado');
  }

  // DELETE: Elimina el archivo físicamente de la carpeta
  remove(filename: string) {
    const filePath = path.join(this.uploadPath, filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath); // Esta instrucción de Node.js borra el archivo
      return { message: `El documento ${filename} fue eliminado correctamente` };
    }

    throw new NotFoundException('No se puede borrar: el documento no existe');
  }
}
