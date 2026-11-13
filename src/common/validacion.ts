import { ValidationPipe } from '@nestjs/common';

/**
 * ValidationPipe para los DTOs de los módulos nuevos (carpetas, auditoría, subidas).
 * Se aplica por parámetro y no de forma global para no alterar el comportamiento
 * de los endpoints existentes (login, registro), cuyos DTOs no están preparados.
 * - whitelist: descarta campos que no estén declarados en el DTO.
 * - transform: convierte los textos de multipart/query ("12") al tipo del DTO (12).
 */
export const validarDto = new ValidationPipe({ whitelist: true, transform: true });
