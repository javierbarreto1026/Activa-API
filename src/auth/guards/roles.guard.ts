import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: { rol?: string } }>();
    const user = request.user;

    if (!user || !user.rol) {
      throw new ForbiddenException('No tienes permisos suficientes para realizar esta acción.');
    }

    const userRol = String(user.rol).toLowerCase().trim();
    const tienePermiso = requiredRoles.some((role) => role.toLowerCase().trim() === userRol);

    if (!tienePermiso) {
      throw new ForbiddenException(
        'Acceso denegado: solo un Administrador puede realizar esta acción.',
      );
    }

    return true;
  }
}
