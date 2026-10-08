import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

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

  @Column({ default: 'GENERAL' })
  departamento!: string;

  @Column()
  usuarioId!: number;

  @CreateDateColumn()
  fechaSubida!: Date;
}
