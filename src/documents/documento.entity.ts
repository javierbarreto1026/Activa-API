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

  @Column()
  departamento!: string;

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
}
