import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from './usuario.entity';
import { CreateUsuarioDto } from './create-usuario.dto';
import { LoginUsuarioDto } from './login-usuario.dto';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario)
    private usuarioRepository: Repository<Usuario>,
    private readonly configService: ConfigService,
    private jwtService: JwtService,
    private readonly mailerService: MailerService,
  ) {}

  async crearUsuarioPorAdmin(datos: {
    nombre: string;
    correo: string;
    contrasena: string;
    departamento: string;
    rol?: string;
  }) {
    const validacion = validarComplejidadContrasena(datos.contrasena);
    if (!validacion.valida) {
      throw new BadRequestException(validacion.mensaje);
    }

    const existe = await this.usuarioRepository.findOne({ where: { correo: datos.correo } });
    if (existe) {
      throw new BadRequestException('Este correo ya está registrado en el sistema.');
    }

    const salt = await bcrypt.genSalt(10);
    const contrasenaHasheada = await bcrypt.hash(datos.contrasena, salt);

    const nuevoUsuario = this.usuarioRepository.create({
      nombre: datos.nombre,
      correo: datos.correo,
      contrasena: contrasenaHasheada,
      departamento: datos.departamento,
      rol: datos.rol || 'Administrador',
    });

    await this.usuarioRepository.save(nuevoUsuario);
    return { message: 'Usuario creado exitosamente.' };
  }

  async crearUsuario(createUsuarioDto: CreateUsuarioDto): Promise<Usuario> {
    const { correo, contrasena, nombre, departamento } = createUsuarioDto;

    // 1. Validar complejidad de contraseña
    const validacion = validarComplejidadContrasena(contrasena);
    if (!validacion.valida) {
      throw new BadRequestException(validacion.mensaje);
    }

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
      departamento,
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

    const payload = { sub: usuario.id, correo: usuario.correo, rol: usuario.rol };
    const tokenGenerado = this.jwtService.sign(payload);

    return {
      id: usuario.id,
      nombre: usuario.nombre,
      correo: usuario.correo,
      rol: usuario.rol,
      departamento: usuario.departamento,
      token: tokenGenerado,
    };
  }

  async findAll() {
    return await this.usuarioRepository.find();
  }

  async findOne(id: number) {
    const usuario = await this.usuarioRepository.findOne({ where: { id } });
    if (!usuario) {
      throw new NotFoundException(`El usuario con ID ${id} no fue encontrado`);
    }
    return usuario;
  }

  async solicitarCodigoRecuperacion(correo: string) {
    const usuario = await this.usuarioRepository.findOne({ where: { correo } });
    if (!usuario) {
      throw new NotFoundException('No existe una cuenta vinculada a este correo.');
    }

    const codigo = Math.floor(100000 + Math.random() * 900000).toString();

    const expiracion = new Date();
    expiracion.setMinutes(expiracion.getMinutes() + 15);

    usuario.codigoRecuperacion = codigo;
    usuario.expiracionCodigo = expiracion;
    await this.usuarioRepository.save(usuario);

    await this.mailerService.sendMail({
      to: correo,
      subject: `${codigo} es tu código de verificación | Activa Uniformes`,
      html: `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e6e3e2; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          
          <!-- Cabecera de marca -->
          <div style="background-color: #121212; padding: 1.8rem; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 1.5rem; letter-spacing: 1px;">
              <strong>ACTIVA</strong> <span style="color: #c8102e;">UNIFORMES</span>
            </h1>
            <p style="color: #a0a0a0; margin: 0.3rem 0 0 0; font-size: 0.85rem;">Portal de Gestión Documental</p>
          </div>

          <!-- Cuerpo del mensaje -->
          <div style="padding: 2rem; color: #333333; line-height: 1.6;">
            <h2 style="color: #121212; font-size: 1.2rem; margin-top: 0;">Restablecimiento de Contraseña</h2>
            <p style="font-size: 0.95rem; color: #555555;">
              Hola <strong>${usuario.nombre || 'Usuario'}</strong>, recibimos una solicitud para cambiar la clave de acceso a tu cuenta corporativa.
            </p>

            <p style="font-size: 0.9rem; color: #555555; margin-bottom: 0.5rem;">Usa el siguiente código de verificación:</p>
            
            <!-- Recuadro del código OTP -->
            <div style="background-color: #f8f9fa; border: 2px dashed #c8102e; border-radius: 8px; padding: 1rem; text-align: center; margin: 1.5rem 0;">
              <span style="font-size: 2.2rem; font-weight: 800; letter-spacing: 8px; color: #c8102e; display: inline-block;">${codigo}</span>
            </div>

            <p style="font-size: 0.85rem; color: #777777; margin-bottom: 1.5rem;">
              ⏳ Este código es válido durante <strong>15 minutos</strong>. Si no solicitaste este cambio, puedes ignorar este mensaje de forma segura.
            </p>

            <hr style="border: none; border-top: 1px solid #eeeeee; margin: 1.5rem 0;" />

            <p style="font-size: 0.78rem; color: #999999; text-align: center; margin: 0;">
              Por seguridad, nunca compartas este código con nadie.<br>
              © ${new Date().getFullYear()} Activa Uniformes S.A.S.
            </p>
          </div>
        </div>
      `,
    });

    return { message: 'Código enviado con éxito.' };
  }

  async restablecerContrasena(correo: string, codigo: string, nuevaContrasena: string) {
    // 1. Validar complejidad de contraseña
    const validacion = validarComplejidadContrasena(nuevaContrasena);
    if (!validacion.valida) {
      throw new BadRequestException(validacion.mensaje);
    }

    const usuario = await this.usuarioRepository.findOne({ where: { correo } });

    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado.');
    }

    if (!usuario.codigoRecuperacion || usuario.codigoRecuperacion !== codigo) {
      throw new BadRequestException('El código ingresado es incorrecto.');
    }

    if (new Date() > new Date(usuario.expiracionCodigo)) {
      throw new BadRequestException('El código ha expirado. Solicita uno nuevo.');
    }

    const salt = await bcrypt.genSalt(10);
    usuario.contrasena = await bcrypt.hash(nuevaContrasena, salt);

    usuario.codigoRecuperacion = '';
    usuario.expiracionCodigo = null as unknown as Date;

    await this.usuarioRepository.save(usuario);

    return { message: 'Contraseña actualizada correctamente.' };
  }
}

// Función Helper ubicada fuera de la clase
function validarComplejidadContrasena(clave: string): { valida: boolean; mensaje?: string } {
  if (!clave || clave.length < 8) {
    return { valida: false, mensaje: 'La contraseña debe tener al menos 8 caracteres.' };
  }
  if (!/[A-Z]/.test(clave)) {
    return { valida: false, mensaje: 'La contraseña debe contener al menos una letra mayúscula.' };
  }
  if (!/[a-z]/.test(clave)) {
    return { valida: false, mensaje: 'La contraseña debe contener al menos una letra minúscula.' };
  }
  if (!/\d/.test(clave)) {
    return { valida: false, mensaje: 'La contraseña debe contener al menos un número.' };
  }
  return { valida: true };
}
