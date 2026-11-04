import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { extname } from 'node:path';
import { open, unlink } from 'node:fs/promises';

/** Peso máximo por archivo: 25 MB. */
export const TAMANO_MAXIMO_MB = 25;
export const TAMANO_MAXIMO_BYTES = TAMANO_MAXIMO_MB * 1024 * 1024;

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

export const opcionesSubida: MulterOptions = {
  storage: diskStorage({
    destination: './uploads',
    filename: (_req, file, cb) => {
      const sufijo = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `file-${sufijo}${extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: {
    fileSize: TAMANO_MAXIMO_BYTES,
    files: 1, // un archivo por petición
  },
  // Filtro 1 y 2: extensión en lista blanca + MIME coherente con la extensión.
  fileFilter: (_req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase();
    const mimesValidos = TIPOS_PERMITIDOS[ext];

    if (!mimesValidos) {
      return cb(new BadRequestException(mensajeTipoNoPermitido()), false);
    }
    if (!mimesValidos.includes(file.mimetype)) {
      return cb(
        new BadRequestException(`El contenido del archivo no corresponde a la extensión ${ext}.`),
        false,
      );
    }
    cb(null, true);
  },
};

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

/**
 * Comprueba que el archivo ya guardado en disco tenga la firma binaria
 * correspondiente a su extensión. Si no coincide, lo elimina y lanza un 400.
 */
export async function verificarContenidoArchivo(file: Express.Multer.File): Promise<void> {
  const ext = extname(file.originalname).toLowerCase();
  const verificar = FIRMAS[ext];

  let cabecera: Buffer;
  const fh = await open(file.path, 'r');
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(512), 0, 512, 0);
    cabecera = buffer.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }

  if (!verificar || cabecera.length === 0 || !verificar(cabecera)) {
    await unlink(file.path).catch(() => undefined);
    throw new BadRequestException(
      `El archivo "${file.originalname}" no es un ${ext || 'archivo'} válido o está dañado.`,
    );
  }
}
