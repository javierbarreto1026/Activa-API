import { IsNotEmpty, IsString } from 'class-validator';
import { SubirDocumentoDto } from './subir-documento.dto';

/**
 * Campos de texto de POST /documents/upload-carpeta (junto a los archivos en "files").
 *
 * `rutas` es un arreglo JSON con la ruta relativa de cada archivo (File.webkitRelativePath),
 * en el mismo orden en que se adjuntan los archivos:
 *   ["Contratos/2026/contrato-juan.pdf", "Contratos/2026/anexos/cedula.jpg"]
 * Se envía aparte porque los navegadores solo mandan el nombre del archivo, sin carpetas.
 *
 * `carpetaId` / `departamento` indican dónde se crea la carpeta subida ("Contratos").
 */
export class SubirCarpetaDto extends SubirDocumentoDto {
  @IsString()
  @IsNotEmpty()
  rutas!: string;
}
