import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  ValueTransformer,
} from 'typeorm';
import { Usuario } from '../usuarios/usuario.entity';
import { Carpeta } from '../folders/carpeta.entity';
import { DEPARTAMENTOS, type Departamento } from '../common/departamentos';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * MySQL guarda las columnas DATE como texto 'YYYY-MM-DD' (sin hora ni zona horaria).
 * Este transformer convierte en hora LOCAL en ambos sentidos. Así se evita que,
 * por ejemplo en Colombia (UTC-5), el 10/05/2023 se guarde como 09/05/2023.
 */
const fechaLocalTransformer: ValueTransformer = {
  to: (valor?: Date | null): string | null => {
    if (!valor) return null;
    return `${valor.getFullYear()}-${pad(valor.getMonth() + 1)}-${pad(valor.getDate())}`;
  },
  from: (valor?: string | Date | null): Date | null => {
    if (!valor) return null;
    if (valor instanceof Date) return valor;
    const [anio, mes, dia] = valor.split('-').map(Number);
    return new Date(anio, mes - 1, dia);
  },
};

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

  /** Solo se admiten las áreas de src/common/departamentos.ts (columna ENUM). */
  @Column({ type: 'enum', enum: DEPARTAMENTOS })
  departamento!: Departamento;

  @Column()
  usuarioId!: number;

  /**
   * Fecha real del documento (p. ej. una factura de 2023). La asigna el usuario al subirlo.
   * Es nullable para no romper los registros existentes: en ese caso se usa fechaSubida.
   */
  @Column({ type: 'date', nullable: true, transformer: fechaLocalTransformer })
  fecha!: Date | null;

  /**
   * Fecha de registro en el servidor (equivale a createdAt).
   * No se renombra: con synchronize: true, TypeORM borraría la columna y sus datos.
   */
  @CreateDateColumn()
  fechaSubida!: Date;

  @ManyToOne(() => Usuario)
  @JoinColumn({ name: 'usuarioId' })
  usuario!: Usuario;

  /**
   * Carpeta que contiene el documento (null = raíz del área).
   * Es nullable, así que los documentos existentes quedan en la raíz de su área.
   * Sin onDelete: la BD impide borrar una carpeta que aún tiene documentos.
   */
  @Column({ type: 'int', nullable: true })
  carpetaId!: number | null;

  @ManyToOne(() => Carpeta, (carpeta) => carpeta.documentos, { nullable: true })
  @JoinColumn({ name: 'carpetaId' })
  carpeta?: Carpeta | null;
}
