import { Controller, Get, Post, Body, Redirect, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from './usuarios/usuario.entity';

interface LoginDto {
  username?: string;
  password?: string;
}

@Controller()
export class AppController {
  // Inyectamos la conexión directa a la tabla "usuarios"
  constructor(
    @InjectRepository(Usuario)
    private usuarioRepository: Repository<Usuario>,
  ) {}

  @Get()
  @Redirect('/login.html', 302)
  raiz() {}

  @Post('api/login')
  // Agregamos 'async' porque consultar a la base de datos toma tiempo
  async login(@Body() datosDelFormulario: LoginDto) {
    const username = datosDelFormulario.username || '';
    const password = datosDelFormulario.password || '';

    // 1. Buscamos al usuario en MySQL por su correo
    const usuarioEncontrado = await this.usuarioRepository.findOne({
      where: { correo: username },
    });

    // 2. Verificamos si existe y si la contraseña coincide
    if (usuarioEncontrado && usuarioEncontrado.contrasena === password) {
      return {
        success: true,
        mensaje: '¡Bienvenido!',
        usuario: usuarioEncontrado.nombre,
        departamento: usuarioEncontrado.departamento,
      };
    }

    // Si no existe o la clave es incorrecta, rechazamos el acceso
    throw new UnauthorizedException('Credenciales incorrectas');
  }
}
