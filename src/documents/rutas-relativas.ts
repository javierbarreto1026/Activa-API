import { BadRequestException } from '@nestjs/common';
import { PROFUNDIDAD_MAXIMA_CARPETAS, sanearNombreCarpeta } from '../folders/nombre-carpeta';

export interface RutaRelativa {
  /** Ruta tal como la envió el navegador (para informar al usuario). */
  original: string;
  /** Carpetas desde la carpeta seleccionada hasta el archivo, con nombres ya saneados. */
  carpetas: string[];
  /** Nombre del archivo. */
  archivo: string;
}

const LONGITUD_MAXIMA_RUTA = 1024;

/**
 * Interpreta el campo "rutas" de la carga masiva: un arreglo JSON con una ruta relativa
 * por archivo ("Contratos/2026/contrato.pdf"), en el mismo orden que los archivos.
 */
export function parsearRutas(json: string | undefined, cantidadArchivos: number): RutaRelativa[] {
  let lista: unknown = null;
  try {
    lista = JSON.parse(json ?? '');
  } catch {
    // se informa abajo
  }

  if (
    !Array.isArray(lista) ||
    lista.length !== cantidadArchivos ||
    !lista.every((r): r is string => typeof r === 'string')
  ) {
    throw new BadRequestException(
      'El campo "rutas" debe ser un arreglo JSON con la ruta relativa de cada archivo, ' +
        'en el mismo orden en que se adjuntan los archivos.',
    );
  }

  return lista.map(parsearRuta);
}

function parsearRuta(ruta: string): RutaRelativa {
  const partes = ruta
    .normalize('NFC')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);

  if (
    ruta.length > LONGITUD_MAXIMA_RUTA ||
    partes.length === 0 ||
    partes.some((p) => p === '.' || p === '..')
  ) {
    throw new BadRequestException(`Ruta de archivo no válida: "${ruta.slice(0, 200)}"`);
  }
  if (partes.length - 1 > PROFUNDIDAD_MAXIMA_CARPETAS) {
    throw new BadRequestException(
      `La carpeta tiene más de ${PROFUNDIDAD_MAXIMA_CARPETAS} niveles de subcarpetas.`,
    );
  }

  const archivo = partes.pop()!;
  return { original: ruta, carpetas: partes.map(sanearNombreCarpeta), archivo };
}
