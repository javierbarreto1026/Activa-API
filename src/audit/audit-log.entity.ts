import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Usuario } from '../usuarios/usuario.entity';

export const ACCIONES_AUDITORIA = [
  'UPLOAD_DOCUMENT',
  'DELETE_DOCUMENT',
  'CREATE_FOLDER',
  'RENAME_FOLDER',
  'UPDATE_USER',
] as const;

export type AccionAuditoria = (typeof ACCIONES_AUDITORIA)[number];

/** Registro de actividad. Solo lo consultan los administradores (GET /logs). */
@Entity('audit_logs')
@Index(['createdAt'])
@Index(['department', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  userId!: number;

  // Sin clave foránea: el historial debe conservarse aunque el usuario se elimine.
  @ManyToOne(() => Usuario, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'userId' })
  user?: Usuario | null;

  @Column({ type: 'varchar', length: 40 })
  action!: AccionAuditoria;

  @Column({ type: 'varchar', length: 50, nullable: true })
  department!: string | null;

  @Column({ type: 'text', nullable: true })
  details!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
