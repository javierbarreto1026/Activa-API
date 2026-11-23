import { normalizarTexto } from '../common/texto';

/** Los fragmentos más cortos ("ana", "sst") aparecen por casualidad en cualquier clave. */
const LONGITUD_FRAGMENTO = 4;

export const MENSAJE_CLAVE_IGUAL = 'La nueva contraseña no puede ser igual a la anterior';
export const MENSAJE_CLAVE_CON_DATOS_PERSONALES =
  'La contraseña no puede contener partes de tu correo electrónico o nombre';

interface ResultadoValidacion {
  valida: boolean;
  mensaje?: string;
}

/** Requisitos al crear una cuenta. */
export function validarComplejidadContrasena(clave: string): ResultadoValidacion {
  if (!clave || clave.length < 8) {
    return { valida: false, mensaje: 'La contraseña debe tener al menos 8 caracteres.' };
  }
  if (!/[A-Z]/.test(clave)) {
    return { valida: false, mensaje: 'La contraseña debe contener al menos una letra mayúscula.' };
  }
  if (!/[a-z]/.test(clave)) {
    return { valida: false, mensaje: 'La contraseña debe contener al menos una letra minúscula.' };
  }
  if (!/[0-9]/.test(clave)) {
    return { valida: false, mensaje: 'La contraseña debe contener al menos un número.' };
  }
  return { valida: true };
}

/** Requisitos al restablecer la clave: los de creación más un carácter especial. */
export function validarRequisitosRestablecimiento(clave: string): ResultadoValidacion {
  const base = validarComplejidadContrasena(clave);
  if (!base.valida) return base;
  if (!/[^A-Za-z0-9]/.test(clave)) {
    return { valida: false, mensaje: 'La contraseña debe contener al menos un carácter especial.' };
  }
  return { valida: true };
}

/** Tramos seguidos de solo letras o solo números, sin tildes ni mayúsculas. */
function tramos(texto: string): string[] {
  const encontrados = normalizarTexto(texto).match(/\p{L}+|\p{N}+/gu) ?? [];
  return encontrados.filter((t) => t.length >= LONGITUD_FRAGMENTO);
}

/**
 * Indica si la clave contiene un fragmento de 4 o más caracteres del correo (antes de
 * la @) o una palabra del nombre.
 *
 * En el correo, nombre y apellido suelen ir pegados ("javierbarreto1026") y separar por
 * números o símbolos no los distingue: se busca cualquier subcadena de 4 caracteres de cada
 * tramo, lo que cubre "javier" y "barreto" (toda subcadena más larga contiene una de 4).
 *
 * La regla del correo se replica en public/login.js (contieneParteDelCorreo).
 */
export function contieneDatosPersonales(clave: string, correo: string, nombre: string): boolean {
  const claveNormalizada = normalizarTexto(clave);

  const parteLocal = (correo ?? '').split('@')[0];
  const deCorreo = tramos(parteLocal).flatMap((tramo) =>
    Array.from({ length: tramo.length - LONGITUD_FRAGMENTO + 1 }, (_, i) =>
      tramo.slice(i, i + LONGITUD_FRAGMENTO),
    ),
  );

  return [...deCorreo, ...tramos(nombre)].some((f) => claveNormalizada.includes(f));
}
