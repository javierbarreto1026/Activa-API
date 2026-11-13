import { BadRequestException } from '@nestjs/common';

export const LONGITUD_MAXIMA_NOMBRE_CARPETA = 100;

/** Niveles máximos de anidación dentro de un área (protege de árboles absurdos o ciclos). */
export const PROFUNDIDAD_MAXIMA_CARPETAS = 30;

// Los mismos que prohíbe Windows en nombres de carpeta, más los caracteres de control.
const PROHIBIDOS = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|']);
const esProhibido = (ch: string) => {
  const codigo = ch.charCodeAt(0);
  return PROHIBIDOS.has(ch) || codigo < 32 || codigo === 127;
};

const limpiarEspacios = (valor: string) => valor.normalize('NFC').replace(/\s+/g, ' ').trim();

/** Valida el nombre escrito por el usuario (crear / renombrar). Lanza 400 si no es válido. */
export function validarNombreCarpeta(valor: unknown): string {
  const nombre = typeof valor === 'string' ? limpiarEspacios(valor) : '';

  if (!nombre) {
    throw new BadRequestException('El nombre de la carpeta es obligatorio.');
  }
  if (nombre.length > LONGITUD_MAXIMA_NOMBRE_CARPETA) {
    throw new BadRequestException(
      `El nombre de la carpeta no puede superar ${LONGITUD_MAXIMA_NOMBRE_CARPETA} caracteres.`,
    );
  }
  if ([...nombre].some(esProhibido)) {
    throw new BadRequestException(
      'El nombre de la carpeta no puede contener los caracteres \\ / : * ? " < > |',
    );
  }
  if (/^\.+$/.test(nombre)) {
    throw new BadRequestException('El nombre de la carpeta no es válido.');
  }
  return nombre;
}

/**
 * Para la carga masiva: los nombres vienen del PC del usuario, así que en lugar de
 * rechazar la subida se corrigen (caracteres prohibidos → "-", longitud recortada).
 */
export function sanearNombreCarpeta(valor: string): string {
  const nombre = limpiarEspacios([...valor].map((ch) => (esProhibido(ch) ? '-' : ch)).join(''))
    .slice(0, LONGITUD_MAXIMA_NOMBRE_CARPETA)
    .trim();
  return !nombre || /^\.+$/.test(nombre) ? 'Sin nombre' : nombre;
}
