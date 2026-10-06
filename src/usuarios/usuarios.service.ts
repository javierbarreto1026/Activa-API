import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from './usuario.entity';
import { CreateUsuarioDto } from './create-usuario.dto';
import { LoginUsuarioDto } from './login-usuario.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario)
    private usuarioRepository: Repository<Usuario>,
  ) {}

  // --- MÉTODO 1: REGISTRO ---
  async crearUsuario(createUsuarioDto: CreateUsuarioDto): Promise<Usuario> {
    const { correo, contrasena, nombre } = createUsuarioDto;

    const usuarioExistente = await this.usuarioRepository.findOne({ where: { correo } });
    if (usuarioExistente) {
      throw new BadRequestException('El correo ya está registrado en el sistema');
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(contrasena, saltRounds);

    const nuevoUsuario = this.usuarioRepository.create({
      nombre,
      correo,
      contrasena: hashedPassword,
    });

    return this.usuarioRepository.save(nuevoUsuario);
  }

  // --- MÉTODO 2: LOGIN (Este va justo debajo del anterior, antes de la última llave) ---
  async validarUsuario(loginUsuarioDto: LoginUsuarioDto) {
    const { correo, contrasena } = loginUsuarioDto;

    const usuario = await this.usuarioRepository.findOne({ where: { correo } });
    if (!usuario) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    const contrasenaValida = await bcrypt.compare(contrasena, usuario.contrasena);
    if (!contrasenaValida) {
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    return {
      id: usuario.id,
      nombre: usuario.nombre,
      correo: usuario.correo,
    };
  }
} // <-- Esta es la llave final que cierra la clase
