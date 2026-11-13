import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { Usuario } from './usuario.entity';
import type { UsuarioSesion } from '../auth/usuario-sesion';

interface JwtPayload {
  sub: number;
  correo: string;
  rol: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepository: Repository<Usuario>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: 'MI_CLAVE_SECRETA_SENA',
    });
  }

  /**
   * Lo que se retorna aquí queda disponible como req.user.
   *
   * El rol y el departamento se leen de la BD en cada petición (consulta por clave
   * primaria) en lugar de confiar en el token: así el control de acceso por área
   * funciona también con tokens emitidos antes de este cambio, y si un administrador
   * cambia el área o el rol de alguien, se aplica de inmediato y no al caducar el token.
   */
  async validate(payload: JwtPayload): Promise<UsuarioSesion> {
    if (!Number.isInteger(payload?.sub)) {
      throw new UnauthorizedException('Token no válido');
    }

    const usuario = await this.usuarioRepository.findOne({
      where: { id: payload.sub },
      select: { id: true, nombre: true, correo: true, rol: true, departamento: true },
    });
    if (!usuario) {
      throw new UnauthorizedException('La cuenta asociada a esta sesión ya no existe');
    }

    return {
      id: usuario.id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      rol: (usuario.rol ?? '').trim(),
      departamento: (usuario.departamento ?? '').trim(),
    };
  }
}
