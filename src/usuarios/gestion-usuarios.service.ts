import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { COLUMNAS_PUBLICAS_USUARIO, Usuario } from './usuario.entity';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { UsuarioSesion } from '../auth/usuario-sesion';
import { AuditService } from '../audit/audit.service';

/** Lo único que sale de la API sobre un usuario (nunca la contraseña ni el código de recuperación). */
export interface UsuarioGestion {
  id: number;
  nombre: string;
  email: string;
  rol: string;
  departamento: string;
  fechaCreacion: Date;
}

function serializar(u: Usuario): UsuarioGestion {
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.correo,
    rol: (u.rol ?? '').trim(),
    departamento: (u.departamento ?? '').trim(),
    fechaCreacion: u.fecha_creacion,
  };
}

function esCorreoDuplicado(err: unknown): boolean {
  const e = err as { code?: string; driverError?: { code?: string } };
  return e?.code === 'ER_DUP_ENTRY' || e?.driverError?.code === 'ER_DUP_ENTRY';
}

const MENSAJE_CORREO_EN_USO = 'Ese correo ya pertenece a otro usuario.';

/** Panel de Gestión de Usuarios (solo administradores: ver UsersController). */
@Injectable()
export class GestionUsuariosService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuarioRepository: Repository<Usuario>,
    private readonly auditService: AuditService,
  ) {}

  async listar(): Promise<UsuarioGestion[]> {
    const usuarios = await this.usuarioRepository.find({
      select: COLUMNAS_PUBLICAS_USUARIO,
      order: { nombre: 'ASC', id: 'ASC' },
    });
    return usuarios.map(serializar);
  }

  async actualizar(id: number, dto: UpdateUserDto, admin: UsuarioSesion): Promise<UsuarioGestion> {
    if (dto.email === undefined && dto.departamento === undefined) {
      throw new BadRequestException('Indica el correo o el departamento que quieres modificar.');
    }

    const usuario = await this.usuarioRepository.findOne({
      where: { id },
      select: { ...COLUMNAS_PUBLICAS_USUARIO, codigoRecuperacion: true, expiracionCodigo: true },
    });
    if (!usuario) throw new NotFoundException(`El usuario con ID ${id} no existe.`);

    const cambios: string[] = [];
    const parcial: Partial<Usuario> = {};

    if (dto.email !== undefined && dto.email !== usuario.correo.toLowerCase()) {
      const ocupado = await this.usuarioRepository.exists({
        where: { correo: dto.email, id: Not(id) },
      });
      if (ocupado) throw new ConflictException(MENSAJE_CORREO_EN_USO);

      cambios.push(`correo ${usuario.correo} → ${dto.email}`);
      parcial.correo = dto.email;
      // Un código de recuperación pendiente se envió al correo anterior: deja de valer.
      parcial.codigoRecuperacion = null as unknown as string;
      parcial.expiracionCodigo = null as unknown as Date;
    }

    if (dto.departamento !== undefined && dto.departamento !== usuario.departamento) {
      cambios.push(`área ${usuario.departamento || '(vacía)'} → ${dto.departamento}`);
      parcial.departamento = dto.departamento;
    }

    if (cambios.length === 0) return serializar(usuario);

    try {
      await this.usuarioRepository.update({ id }, parcial);
    } catch (err) {
      // Otra petición pudo ocupar el correo entre la comprobación y el UPDATE (índice único).
      if (esCorreoDuplicado(err)) throw new ConflictException(MENSAJE_CORREO_EN_USO);
      throw err;
    }

    const actualizado: Usuario = { ...usuario, ...parcial };

    // El cambio de área se aplica en la siguiente petición del usuario: JwtStrategy
    // lee el departamento de la BD en cada request, no del token.
    await this.auditService.registrar({
      usuarioId: admin.id,
      accion: 'UPDATE_USER',
      departamento: actualizado.departamento,
      detalles: `${usuario.nombre} (#${usuario.id}): ${cambios.join('; ')}`,
    });

    return serializar(actualizado);
  }
}
