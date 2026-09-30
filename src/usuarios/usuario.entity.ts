import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('usuarios')
export class Usuario {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  nombre!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  correo!: string;

  @Column({ type: 'varchar', length: 255 })
  contrasena!: string;

  @Column({ type: 'varchar', length: 50 })
  departamento!: string;

  @CreateDateColumn()
  fecha_creacion!: Date;
}
