import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  canonizarDepartamento,
  MENSAJE_DEPARTAMENTO_INVALIDO,
  type Departamento,
} from '../common/departamentos';
import { normalizarTexto } from '../common/texto';

/** Lo que JwtStrategy deja en `req.user` (datos leídos de la BD en cada petición). */
export interface UsuarioSesion {
  id: number;
  nombre: string;
  correo: string;
  rol: string;
  departamento: string;
}

/** Valores de `usuarios.rol` que se consideran Administrador (sin distinguir mayúsculas). */
export const ROLES_ADMIN = ['admin', 'administrador'];

export function esAdmin(usuario: Pick<UsuarioSesion, 'rol'>): boolean {
  return ROLES_ADMIN.includes(normalizarTexto(usuario.rol));
}

/** Compara áreas sin distinguir mayúsculas ni tildes ("Recursos Humanos" = "recursos humanos"). */
export function mismoDepartamento(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizarTexto(a);
  return na !== '' && na === normalizarTexto(b);
}

/** ¿Puede el usuario ver/operar sobre algo que pertenece a `departamento`? */
export function puedeAcceder(usuario: UsuarioSesion, departamento: string): boolean {
  return esAdmin(usuario) || mismoDepartamento(usuario.departamento, departamento);
}

/** Área oficial de la cuenta. 403 si no tiene o si ya no existe (p. ej. "Producción"). */
function departamentoPropio(usuario: UsuarioSesion): Departamento {
  const propio = canonizarDepartamento(usuario.departamento);
  if (propio) return propio;

  const actual = usuario.departamento?.trim();
  throw new ForbiddenException(
    actual
      ? `Tu cuenta tiene asignada un área que ya no existe ("${actual}"). ` +
          'Pide a un administrador que la actualice.'
      : 'Tu cuenta no tiene un área asignada. Contacta al administrador.',
  );
}

/** Área indicada por un administrador: debe ser una de las oficiales (400 si no). */
function departamentoValido(valor: string): Departamento {
  const departamento = canonizarDepartamento(valor);
  if (!departamento) throw new BadRequestException(MENSAJE_DEPARTAMENTO_INVALIDO);
  return departamento;
}

/**
 * Filtro de área para CONSULTAS.
 * - Administrador: el área pedida, o `undefined` (= todas) si no pide ninguna.
 * - Resto: siempre su propia área; pedir otra distinta responde 403.
 */
export function departamentoParaLectura(
  usuario: UsuarioSesion,
  solicitado?: string,
): Departamento | undefined {
  const pedido = solicitado?.trim() || undefined;
  if (esAdmin(usuario)) return pedido ? departamentoValido(pedido) : undefined;

  const propio = departamentoPropio(usuario);
  if (pedido && !mismoDepartamento(pedido, propio)) {
    throw new ForbiddenException('No tienes acceso a los documentos de esa área.');
  }
  return propio;
}

/**
 * Área efectiva para ESCRITURAS (subir documentos, crear carpetas en la raíz de un área).
 * Siempre devuelve el nombre oficial, así nunca llega a la columna ENUM un valor inválido
 * (tu MariaDB no está en modo estricto: lo guardaría en silencio como '').
 * - Administrador: debe indicar el área destino.
 * - Resto: siempre su propia área (el valor que envíe el cliente no puede cambiarla).
 */
export function departamentoParaEscritura(
  usuario: UsuarioSesion,
  solicitado?: string,
): Departamento {
  const pedido = solicitado?.trim() || undefined;

  if (esAdmin(usuario)) {
    if (!pedido) throw new BadRequestException('Debes indicar el área (departamento) de destino.');
    return departamentoValido(pedido);
  }

  const propio = departamentoPropio(usuario);
  if (pedido && !mismoDepartamento(pedido, propio)) {
    throw new ForbiddenException('Solo puedes guardar documentos y carpetas en tu propia área.');
  }
  return propio;
}
