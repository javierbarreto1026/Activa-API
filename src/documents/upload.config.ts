import {
  ArgumentsHost,
  BadRequestException,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';
import { extname } from 'node:path';
import type { Observable } from 'rxjs';

/** Peso máximo por archivo: 35 MB. */
export const TAMANO_MAXIMO_MB = 35;
export const TAMANO_MAXIMO_BYTES = TAMANO_MAXIMO_MB * 1024 * 1024;

/**
 * Carga masiva de carpetas: el navegador divide la carpeta en lotes que respetan
 * estos dos límites. Como Multer guarda los archivos en RAM (memoryStorage), el
 * límite por petición acota la memoria que puede consumir cada subida.
 */
export const MAX_ARCHIVOS_POR_LOTE = 20;
export const TAMANO_MAXIMO_LOTE_MB = 100;
const TAMANO_MAXIMO_LOTE_BYTES = TAMANO_MAXIMO_LOTE_MB * 1024 * 1024;

/** Longitud de la columna documentos.nombreOriginal. */
export const LONGITUD_MAXIMA_NOMBRE_ARCHIVO = 255;

/**
 * Lista blanca de extensiones permitidas y los tipos MIME aceptados para cada una.
 * Todo lo que no esté aquí (.exe, .bat, .js, .sh, .msi, .html, etc.) se rechaza.
 */
const TIPOS_PERMITIDOS: Record<string, string[]> = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xls': ['application/vnd.ms-excel'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.ppt': ['application/vnd.ms-powerpoint'],
  '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  '.csv': ['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/csv'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.webp': ['image/webp'],
};

export const EXTENSIONES_PERMITIDAS = Object.keys(TIPOS_PERMITIDOS);

const mensajeTipoNoPermitido = () =>
  `Tipo de archivo no permitido. Formatos aceptados: ${EXTENSIONES_PERMITIDAS.join(', ')}`;

/** Traduce el error 413 de Multer ("File too large") a un mensaje en español. */
@Catch(PayloadTooLargeException)
export class ArchivoMuyGrandeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(413)
      .json({
        statusCode: 413,
        error: 'Payload Too Large',
        message: `El archivo supera el tamaño máximo permitido de ${TAMANO_MAXIMO_MB} MB.`,
      });
  }
}

/**
 * Filtros 1 y 2: extensión en lista blanca + MIME coherente con la extensión.
 * Devuelve el motivo del rechazo, o null si el archivo es aceptable.
 */
export function motivoTipoNoPermitido(nombre: string, mimetype: string): string | null {
  const ext = extname(nombre).toLowerCase();
  const mimesValidos = TIPOS_PERMITIDOS[ext];

  if (!mimesValidos) return mensajeTipoNoPermitido();
  if (!mimesValidos.includes(mimetype)) {
    return `El contenido del archivo no corresponde a la extensión ${ext}.`;
  }
  return null;
}

export const opcionesSubida: MulterOptions = {
  // El archivo se mantiene en RAM (file.buffer) solo durante la petición y se envía
  // directo a Cloudflare R2 (o, sin credenciales de R2, a /uploads). El límite de
  // tamaño de abajo acota la memoria que puede consumir cada subida.
  storage: memoryStorage(),
  // Los navegadores envían el nombre del archivo en UTF-8. Con el valor por defecto
  // (latin1) "Producción.pdf" llegaría como "ProducciÃ³n.pdf".
  defParamCharset: 'utf8',
  limits: {
    fileSize: TAMANO_MAXIMO_BYTES,
    files: 1, // un archivo por petición
  },
  fileFilter: (_req, file, cb) => {
    const motivo = motivoTipoNoPermitido(file.originalname, file.mimetype);
    if (motivo) {
      return cb(new BadRequestException(motivo), false);
    }
    cb(null, true);
  },
};

/**
 * Carga masiva (POST /documents/upload-carpeta). Sin fileFilter: cada archivo se valida
 * en el servicio, de modo que los no permitidos (desktop.ini, Thumbs.db, .txt…) se
 * omiten y se informan sin rechazar el resto del lote.
 */
export const opcionesSubidaMasiva: MulterOptions = {
  storage: memoryStorage(),
  defParamCharset: 'utf8',
  limits: {
    fileSize: TAMANO_MAXIMO_BYTES,
    files: MAX_ARCHIVOS_POR_LOTE,
    fields: 10,
    fieldSize: 1024 * 1024, // el campo "rutas" (JSON) de un lote completo cabe de sobra
  },
};

/**
 * Rechaza el lote ANTES de que Multer lo lea en memoria si el cuerpo supera
 * TAMANO_MAXIMO_LOTE_MB. Debe declararse antes que FilesInterceptor.
 */
@Injectable()
export class LimiteTamanoLoteInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const largo = Number(req.headers['content-length']);

    if (!Number.isFinite(largo)) {
      throw new HttpException(
        'La petición debe indicar su tamaño (Content-Length).',
        HttpStatus.LENGTH_REQUIRED,
      );
    }
    if (largo > TAMANO_MAXIMO_LOTE_BYTES) {
      // HttpException (y no PayloadTooLargeException) para que ArchivoMuyGrandeFilter
      // no lo reemplace por el mensaje de "archivo demasiado grande".
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
          error: 'Payload Too Large',
          message: `Cada lote de la carga masiva puede pesar como máximo ${TAMANO_MAXIMO_LOTE_MB} MB.`,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    return next.handle();
  }
}

/* ------------------------------------------------------------------------- */
/* Filtro 3: verificación de la firma binaria ("magic bytes").                */
/* La extensión y el MIME los decide el cliente y se pueden falsificar        */
/* (p. ej. renombrar virus.exe a factura.pdf). Los primeros bytes del archivo */
/* revelan su formato real.                                                   */
/* ------------------------------------------------------------------------- */

const empiezaCon = (buf: Buffer, firma: number[], desde = 0) =>
  buf.length >= desde + firma.length && firma.every((b, i) => buf[desde + i] === b);

const ZIP = [0x50, 0x4b, 0x03, 0x04]; // docx, xlsx, pptx son ZIP por dentro
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // doc, xls, ppt (Office 97-2003)

const FIRMAS: Record<string, (buf: Buffer) => boolean> = {
  '.pdf': (b) => empiezaCon(b, [0x25, 0x50, 0x44, 0x46]), // %PDF
  '.png': (b) => empiezaCon(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  '.jpg': (b) => empiezaCon(b, [0xff, 0xd8, 0xff]),
  '.jpeg': (b) => empiezaCon(b, [0xff, 0xd8, 0xff]),
  '.webp': (b) =>
    empiezaCon(b, [0x52, 0x49, 0x46, 0x46]) && empiezaCon(b, [0x57, 0x45, 0x42, 0x50], 8),
  '.docx': (b) => empiezaCon(b, ZIP),
  '.xlsx': (b) => empiezaCon(b, ZIP),
  '.pptx': (b) => empiezaCon(b, ZIP),
  '.doc': (b) => empiezaCon(b, OLE),
  '.xls': (b) => empiezaCon(b, OLE),
  '.ppt': (b) => empiezaCon(b, OLE),
  // CSV es texto plano: se rechaza si contiene bytes nulos (señal de binario)
  // o si en realidad es un ejecutable de Windows (MZ).
  '.csv': (b) => !b.includes(0x00) && !empiezaCon(b, [0x4d, 0x5a]),
};

/** Motivo por el que el contenido no corresponde a la extensión, o null si es válido. */
export function motivoContenidoNoValido(nombre: string, buffer: Buffer | undefined): string | null {
  const ext = extname(nombre).toLowerCase();
  const verificar = FIRMAS[ext];
  const cabecera = buffer?.subarray(0, 512) ?? Buffer.alloc(0);

  if (!verificar || cabecera.length === 0 || !verificar(cabecera)) {
    return `El archivo "${nombre}" no es un ${ext || 'archivo'} válido o está dañado.`;
  }
  return null;
}

/**
 * Comprueba que el archivo recibido en memoria tenga la firma binaria
 * correspondiente a su extensión. Si no coincide, lanza un 400 (no se almacena).
 */
export function verificarContenidoArchivo(file: Express.Multer.File): void {
  const motivo = motivoContenidoNoValido(file.originalname, file.buffer);
  if (motivo) {
    throw new BadRequestException(motivo);
  }
}

/**
 * Validación completa de un archivo de la carga masiva (nombre, tipo y contenido).
 * `nombre` es el que viene en la ruta relativa, no file.originalname.
 */
export function motivoRechazoArchivo(
  nombre: string,
  file: Pick<Express.Multer.File, 'mimetype' | 'buffer' | 'size'>,
): string | null {
  if (nombre.length > LONGITUD_MAXIMA_NOMBRE_ARCHIVO) {
    return `El nombre del archivo supera ${LONGITUD_MAXIMA_NOMBRE_ARCHIVO} caracteres.`;
  }
  if (!file.size) return 'El archivo está vacío.';
  return (
    motivoTipoNoPermitido(nombre, file.mimetype) ?? motivoContenidoNoValido(nombre, file.buffer)
  );
}
