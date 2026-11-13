import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { UsuarioSesion } from '../usuario-sesion';

/**
 * Inyecta el usuario autenticado (req.user) ya tipado.
 * Usar junto a @UseGuards(JwtAuthGuard).
 */
export const UsuarioActual = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UsuarioSesion => {
    const req = ctx.switchToHttp().getRequest<{ user?: UsuarioSesion }>();
    if (!req.user?.id) {
      throw new UnauthorizedException('Usuario no válido o sesión expirada');
    }
    return req.user;
  },
);
