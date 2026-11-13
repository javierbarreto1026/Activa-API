import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DEPARTAMENTOS, type Departamento } from '../common/departamentos';
import { Documento } from '../documents/documento.entity';
import { Usuario } from '../usuarios/usuario.entity';

/**
 * Carpeta dentro de un área (departamento). Admite subcarpetas mediante `padreId`
 * (null = carpeta en la raíz del área). Todas las carpetas de un árbol comparten
 * el departamento de su raíz.
 *
 * En Cloudflare R2 los documentos se guardan bajo:
 *   documentos/<area>/<carpeta>/<subcarpeta>/<archivo>
 *
 * Claves foráneas que genera TypeORM (las crea el lado ManyToOne):
 *   carpetas.padreId    → carpetas.id  (ON DELETE RESTRICT)
 *   carpetas.usuarioId  → usuarios.id
 *   documentos.carpetaId → carpetas.id (definida en Documento)
 * Los OneToMany (subcarpetas, documentos) son solo el lado inverso: no crean columnas
 * ni claves, sirven para cargar relaciones con `relations: { documentos: true }`.
 */
@Entity('carpetas')
@Index(['departamento', 'padreId'])
export class Carpeta {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  nombre!: string;

  @Column({ type: 'enum', enum: DEPARTAMENTOS })
  departamento!: Departamento;

  @Column({ type: 'int', nullable: true })
  padreId!: number | null;

  // RESTRICT: la BD impide borrar una carpeta que todavía tiene subcarpetas.
  @ManyToOne(() => Carpeta, (carpeta) => carpeta.subcarpetas, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'padreId' })
  padre?: Carpeta | null;

  @OneToMany(() => Carpeta, (carpeta) => carpeta.padre)
  subcarpetas?: Carpeta[];

  @OneToMany(() => Documento, (documento) => documento.carpeta)
  documentos?: Documento[];

  /** Usuario que creó la carpeta. */
  @Column({ type: 'int' })
  usuarioId!: number;

  @ManyToOne(() => Usuario)
  @JoinColumn({ name: 'usuarioId' })
  usuario?: Usuario;

  @CreateDateColumn()
  fechaCreacion!: Date;

  @UpdateDateColumn()
  fechaActualizacion!: Date;
}
