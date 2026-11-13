import { IsString, MaxLength } from 'class-validator';

/** PATCH /folders/:id  { nombre } */
export class RenombrarCarpetaDto {
  @IsString()
  @MaxLength(100)
  nombre!: string;
}
