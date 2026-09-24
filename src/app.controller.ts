import { Controller, Get, Post, Body, Redirect, UnauthorizedException } from '@nestjs/common';

// 1. Creamos el "molde" estricto para evitar el uso de 'any'
interface LoginDto {
  username?: string;
  password?: string;
}

@Controller()
export class AppController {
  @Get()
  @Redirect('/login.html', 302)
  raiz() {}

  @Post('api/login')
  login(@Body() datosDelFormulario: LoginDto) {
    const username = datosDelFormulario.username || '';
    const password = datosDelFormulario.password || '';

    const usuarioValido = 'admin@empresa.com';
    const passwordValida = '123456';

    if (username === usuarioValido && password === passwordValida) {
      return {
        success: true,
        mensaje: '¡Bienvenido!',
        usuario: username,
      };
    }

    throw new UnauthorizedException('Credenciales incorrectas');
  }
}
