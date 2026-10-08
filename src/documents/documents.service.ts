import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Documento } from './documento.entity';

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Documento)
    private documentoRepository: Repository<Documento>,
  ) {}

  // Guardar un nuevo documento en la base de datos
  async guardarDocumento(file: Express.Multer.File, userId: number) {
    const nuevoDocumento = this.documentoRepository.create({
      nombreOriginal: file.originalname,
      nombreGuardado: file.filename,
      ruta: file.path,
      usuarioId: userId, // Guardamos quién lo subió gracias al JWT
      departamento: 'GENERAL', // Lo dejamos genérico por ahora
    });

    return await this.documentoRepository.save(nuevoDocumento);
  }

  // Listar todos los documentos
  async findAll() {
    return await this.documentoRepository.find();
  }

  // Buscar un documento por ID
  async findOne(id: string) {
    return await this.documentoRepository.findOne({ where: { id: Number(id) } });
  }

  // Eliminar un documento
  async remove(id: string) {
    await this.documentoRepository.delete(id);
    return { mensaje: `Documento con id ${id} eliminado correctamente` };
  }
}
