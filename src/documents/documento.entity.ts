import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Usuario } from '../usuarios/usuario.entity';

@Entity('documentos')
export class Documento {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  nombreOriginal!: string;

  @Column()
  nombreGuardado!: string;

  @Column()
  ruta!: string;

  @Column()
  departamento!: string;

  @Column()
  usuarioId!: number;

  @CreateDateColumn()
  fechaSubida!: Date;

  @ManyToOne(() => Usuario)
  @JoinColumn({ name: 'usuarioId' })
  usuario!: Usuario;
}
