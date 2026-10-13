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

  async guardarDocumento(
    file: Express.Multer.File,
    userId: number,
    departamento: string = 'GENERAL',
  ) {
    const nuevoDocumento = this.documentoRepository.create({
      nombreOriginal: file.originalname,
      nombreGuardado: file.filename,
      ruta: file.path,
      usuarioId: userId,
      departamento: departamento,
    });

    return await this.documentoRepository.save(nuevoDocumento);
  }

  async findAll() {
    const documentos = await this.documentoRepository.find({
      relations: { usuario: true },
      order: { id: 'DESC' },
    });

    return documentos.map((doc) => ({
      ...doc,
      nombre: doc.nombreOriginal,
      subidoPor: doc.usuario ? doc.usuario.nombre : `Usuario #${doc.usuarioId}`,
      fecha: doc.fechaSubida || new Date(),
    }));
  }

  async findOne(id: string) {
    return await this.documentoRepository.findOne({ where: { id: Number(id) } });
  }

  async remove(id: string) {
    await this.documentoRepository.delete(id);
    return { mensaje: `Documento con id ${id} eliminado correctamente` };
  }
}
