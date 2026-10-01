import { Controller, Get, Post, Body, UnauthorizedException, Redirect } from '@nestjs/common';
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

  @Get('api/documentos')
  obtenerDocumentos() {
    return [
      {
        id: 1,
        nombre: 'factura_telas_septiembre.pdf',
        subidoPor: 'Carlos Perez',
        fecha: '21/09/2026',
        departamento: 'Contabilidad',
      },
      {
        id: 2,
        nombre: 'balance_general_agosto.xlsx',
        subidoPor: 'Carlos Perez',
        fecha: '15/09/2026',
        departamento: 'Contabilidad',
      },
      {
        id: 3,
        nombre: 'ficha_tecnica_chaqueta.jpg',
        subidoPor: 'Ana Lopez',
        fecha: '10/09/2026',
        departamento: 'Producción',
      },
      {
        id: 4,
        nombre: 'manual_bordado_v2.pdf',
        subidoPor: 'Ana Lopez',
        fecha: '05/09/2026',
        departamento: 'Producción',
      },
      {
        id: 5,
        nombre: 'contrato_nuevo_costurero.pdf',
        subidoPor: 'Maria Gomez',
        fecha: '01/09/2026',
        departamento: 'Recursos Humanos',
      },
      {
        id: 6,
        nombre: 'pago_nomina_quincena.pdf',
        subidoPor: 'Maria Gomez',
        fecha: '15/09/2026',
        departamento: 'Recursos Humanos',
      },
    ];
  }

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
