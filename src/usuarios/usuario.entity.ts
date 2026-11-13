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

  @Column({ default: 'USUARIO ' })
  rol!: string;

  @Column({ type: 'varchar', length: 50, nullable: false })
  departamento!: string;

  @Column({ nullable: true })
  codigoRecuperacion!: string;

  @Column({ type: 'datetime', nullable: true })
  expiracionCodigo!: Date;

  @CreateDateColumn()
  fecha_creacion!: Date;
}

/**
 * Columnas que se pueden devolver por la API (`select` de TypeORM).
 * Excluye la contraseña (hash) y el código de recuperación.
 */
export const COLUMNAS_PUBLICAS_USUARIO = {
  id: true,
  nombre: true,
  correo: true,
  rol: true,
  departamento: true,
  fecha_creacion: true,
} as const;
