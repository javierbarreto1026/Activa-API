import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from './usuario.entity';
import { CreateUsuarioDto } from './create-usuario.dto';
import { LoginUsuarioDto } from './login-usuario.dto';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario)
    private usuarioRepository: Repository<Usuario>,
    private jwtService: JwtService,
  ) {}

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

    const payload = { sub: usuario.id, correo: usuario.correo };

    const tokenGenerado = this.jwtService.sign(payload);

    return {
      id: usuario.id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      token: tokenGenerado,
    };
  }

  async findAll() {
    return await this.usuarioRepository.find();
  }

  // 2. Buscar un usuario por su ID
  async findOne(id: number) {
    const usuario = await this.usuarioRepository.findOne({ where: { id } });
    if (!usuario) {
      throw new NotFoundException(`El usuario con ID ${id} no fue encontrado`);
    }
    return usuario;
  }
}
