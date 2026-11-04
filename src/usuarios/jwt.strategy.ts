import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

interface JwtPayload {
  sub: number;
  correo: string;
  rol: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: 'MI_CLAVE_SECRETA_SENA',
    });
  }

  // Lo que se retorna aquí queda disponible como req.user.
  // Se incluye el rol para que RolesGuard pueda validar permisos.
  validate(payload: JwtPayload): { id: number; correo: string; rol: string } {
    return { id: payload.sub, correo: payload.correo, rol: payload.rol };
  }
}
