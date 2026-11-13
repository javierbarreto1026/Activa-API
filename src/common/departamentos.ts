import { normalizarTexto } from './texto';

/**
 * Áreas de la empresa: ÚNICA fuente de verdad. Se usa en
 * - las columnas ENUM de `documentos.departamento` y `carpetas.departamento`,
 * - la validación de los DTOs (@IsIn),
 * - el control de acceso (usuario-sesion.ts) y el alta de usuarios.
 * Para añadir un área basta con agregarla aquí (y en DEPARTAMENTOS de public/dashboard.html);
 * con synchronize: true TypeORM amplía el ENUM al arrancar.
 */
export const DEPARTAMENTOS = ['Contabilidad', 'Recursos Humanos', 'SST', 'Gerencia'] as const;

export type Departamento = (typeof DEPARTAMENTOS)[number];

export const MENSAJE_DEPARTAMENTO_INVALIDO = `El área debe ser una de: ${DEPARTAMENTOS.join(', ')}.`;

/**
 * Devuelve el nombre oficial del área sin distinguir mayúsculas, tildes ni espacios
 * ("recursos  humanos" → "Recursos Humanos", "sst" → "SST"), o null si no existe.
 */
export function canonizarDepartamento(valor: string | null | undefined): Departamento | null {
  const buscado = normalizarTexto(valor);
  return DEPARTAMENTOS.find((d) => normalizarTexto(d) === buscado) ?? null;
}
