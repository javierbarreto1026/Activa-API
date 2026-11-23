import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { COLUMNAS_PUBLICAS_USUARIO, Usuario } from './usuario.entity';
import { CreateUsuarioDto } from './create-usuario.dto';
import { LoginUsuarioDto } from './login-usuario.dto';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { MailerService } from '@nestjs-modules/mailer';
import { join } from 'path';
import { AuditService } from '../audit/audit.service';
import {
  canonizarDepartamento,
  MENSAJE_DEPARTAMENTO_INVALIDO,
  type Departamento,
} from '../common/departamentos';
import {
  contieneDatosPersonales,
  MENSAJE_CLAVE_CON_DATOS_PERSONALES,
  MENSAJE_CLAVE_IGUAL,
  validarComplejidadContrasena,
  validarRequisitosRestablecimiento,
} from './politica-contrasena';

/** Solo se crean cuentas en las áreas oficiales (se guarda el nombre exacto: "SST", no "sst"). */
function validarDepartamento(valor: string | undefined): Departamento {
  const departamento = canonizarDepartamento(valor);
  if (!departamento) throw new BadRequestException(MENSAJE_DEPARTAMENTO_INVALIDO);
  return departamento;
}

function escaparHtml(t: string): string {
  return t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Texto que las bandejas de entrada muestran junto al asunto. El relleno invisible ocupa el
 * resto de la vista previa para que no se cuele el cuerpo del correo (y con él, el código).
 */
const PREHEADER_RESTABLECIMIENTO =
  'Has solicitado restablecer tu contraseña en el Portal de Gestión Documental. ' +
  'Abre este mensaje para consultar tu código de verificación.' +
  '&zwnj;&nbsp;'.repeat(150);

@Injectable()
export class UsuariosService {
  constructor(
    @InjectRepository(Usuario)
    private usuarioRepository: Repository<Usuario>,
    private readonly configService: ConfigService,
    private jwtService: JwtService,
    private readonly mailerService: MailerService,
    private readonly auditService: AuditService,
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

    // withDeleted: el correo de una cuenta eliminada sigue ocupando el índice único;
    // sin esto el INSERT fallaría con un 500 en vez de un mensaje claro.
    const existe = await this.usuarioRepository.findOne({
      where: { correo: datos.correo },
      withDeleted: true,
    });
    if (existe) {
      throw new BadRequestException(
        existe.fecha_eliminacion
          ? 'Este correo pertenece a una cuenta eliminada. Usa un correo diferente.'
          : 'Este correo ya está registrado en el sistema.',
      );
    }

    const departamento = validarDepartamento(datos.departamento);

    const salt = await bcrypt.genSalt(10);
    const contrasenaHasheada = await bcrypt.hash(datos.contrasena, salt);

    const nuevoUsuario = this.usuarioRepository.create({
      nombre: datos.nombre,
      correo: datos.correo,
      contrasena: contrasenaHasheada,
      departamento,
      rol: datos.rol || 'Administrador',
    });

    await this.usuarioRepository.save(nuevoUsuario);
    return { message: 'Usuario creado exitosamente.' };
  }

  async crearUsuario(createUsuarioDto: CreateUsuarioDto): Promise<Usuario> {
    const { correo, contrasena, nombre } = createUsuarioDto;

    // 1. Validar complejidad de contraseña
    const validacion = validarComplejidadContrasena(contrasena);
    if (!validacion.valida) {
      throw new BadRequestException(validacion.mensaje);
    }
    const departamento = validarDepartamento(createUsuarioDto.departamento);

    // Incluye cuentas eliminadas: su correo sigue ocupando el índice único.
    const usuarioExistente = await this.usuarioRepository.findOne({
      where: { correo },
      withDeleted: true,
    });
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

  // Nunca se devuelven la contraseña (hash) ni el código de recuperación.
  async findAll() {
    return await this.usuarioRepository.find({ select: COLUMNAS_PUBLICAS_USUARIO });
  }

  async findOne(id: number) {
    const usuario = await this.usuarioRepository.findOne({
      where: { id },
      select: COLUMNAS_PUBLICAS_USUARIO,
    });
    if (!usuario) {
      throw new NotFoundException(`El usuario con ID ${id} no fue encontrado`);
    }
    return usuario;
  }

  /**
   * Baja de un usuario (despido o fin de contrato) con borrado lógico.
   *
   * La fila no se borra: sus documentos, carpetas y registros de auditoría siguen
   * apuntando a ella. Pero TypeORM la excluye de toda consulta, así que el login la
   * rechaza y JwtStrategy responde 401 en la siguiente petición: el acceso se pierde
   * de inmediato, aunque el usuario tenga un token todavía vigente.
   *
   * `adminId` sale del token (nunca del cliente) para impedir que el administrador se
   * elimine a sí mismo y deje el sistema sin quien lo gestione.
   */
  async eliminarUsuario(id: number, adminId: number) {
    if (id === adminId) {
      throw new BadRequestException('No puedes eliminar tu propia cuenta.');
    }

    const usuario = await this.usuarioRepository.findOne({
      where: { id },
      select: { id: true, nombre: true, correo: true, departamento: true },
    });
    if (!usuario) {
      throw new NotFoundException(`El usuario con ID ${id} no existe.`);
    }

    await this.usuarioRepository.softDelete({ id });

    await this.auditService.registrar({
      usuarioId: adminId,
      accion: 'DELETE_USER',
      departamento: usuario.departamento,
      detalles: `${usuario.nombre} (#${usuario.id}, ${usuario.correo}): cuenta eliminada y acceso revocado`,
    });

    return { message: `${usuario.nombre} fue eliminado y ya no tiene acceso al sistema.` };
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

    const fechaSolicitud = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota',
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(new Date());
    const nombre = escaparHtml(usuario.nombre || 'Usuario');
    const correoSeguro = escaparHtml(correo);

    await this.mailerService.sendMail({
      to: correo,
      subject: 'Solicitud de restablecimiento de contraseña | Activa Uniformes',
      attachments: [
        {
          filename: 'logo-activa.png',
          path: join(process.cwd(), 'public', 'favicon.png'),
          cid: 'logo-activa',
        },
      ],
      html: `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;">
<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${PREHEADER_RESTABLECIMIENTO}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;font-family:Arial,Helvetica,sans-serif;">
      <tr><td align="center" style="background-color:#0c0c0c;border-bottom:3px solid #c8102e;padding:28px 24px;">
        <img src="cid:logo-activa" alt="Activa Uniformes" width="56" height="56" style="display:block;margin:0 auto 12px auto;border:0;">
        <div style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:2px;">ACTIVA UNIFORMES</div>
        <div style="color:#a0a0a0;font-size:11px;letter-spacing:2px;margin-top:6px;">SISTEMA DE GESTIÓN DOCUMENTAL</div>
      </td></tr>
      <tr><td style="padding:32px 32px 8px 32px;color:#333333;font-size:15px;line-height:1.6;">
        <p style="margin:0 0 16px 0;font-size:16px;color:#0c0c0c;">Estimado(a) <strong>${nombre}</strong>,</p>
        <p style="margin:0;color:#555555;">Se ha generado una solicitud de validación de identidad para el restablecimiento de las credenciales de acceso a su cuenta. Para continuar, ingrese el siguiente código en la plataforma:</p>
      </td></tr>
      <tr><td style="padding:20px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f8f9fa;border:1px solid #e5e7eb;border-top:3px solid #c8102e;">
          <tr><td align="center" style="padding:20px 12px;">
            <div style="font-size:11px;font-weight:bold;letter-spacing:2px;color:#6b7280;margin-bottom:12px;">CÓDIGO DE VERIFICACIÓN DE UN SOLO USO</div>
            <div style="font-family:'Courier New',Courier,monospace;font-size:30px;font-weight:bold;letter-spacing:8px;color:#0c0c0c;">${codigo}</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 32px 20px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;font-size:13px;">
          <tr><td colspan="2" style="background-color:#f8f9fa;padding:10px 14px;font-weight:bold;color:#0c0c0c;border-bottom:1px solid #e5e7eb;">Detalles de la solicitud</td></tr>
          <tr><td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #e5e7eb;width:40%;">Usuario / Cuenta</td><td style="padding:10px 14px;color:#0c0c0c;border-bottom:1px solid #e5e7eb;">${correoSeguro}</td></tr>
          <tr><td style="padding:10px 14px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Fecha y hora de solicitud</td><td style="padding:10px 14px;color:#0c0c0c;border-bottom:1px solid #e5e7eb;">${fechaSolicitud} (hora de Colombia)</td></tr>
          <tr><td style="padding:10px 14px;color:#6b7280;">Tiempo de expiración</td><td style="padding:10px 14px;color:#0c0c0c;">15 minutos</td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 32px 28px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-left:3px solid #c8102e;background-color:#fdf2f4;">
          <tr><td style="padding:12px 16px;font-size:13px;line-height:1.6;color:#555555;">
            <strong style="color:#0c0c0c;">Aviso de seguridad.</strong> Si usted no inició este proceso, ignore este mensaje y notifique al administrador del sistema; su contraseña actual permanecerá sin cambios. Por su seguridad, no comparta este código con ninguna persona.
          </td></tr>
        </table>
      </td></tr>
      <tr><td align="center" style="background-color:#f8f9fa;border-top:1px solid #e5e7eb;padding:16px 24px;font-size:11px;color:#9ca3af;line-height:1.6;">
        © ${new Date().getFullYear()} Activa Uniformes S.A.S. · Todos los derechos reservados · Mensaje automático, por favor no responder
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
    });

    return { message: 'Código enviado con éxito.' };
  }

  async restablecerContrasena(correo: string, codigo: string, nuevaContrasena: string) {
    // 1. Requisitos mínimos de la contraseña
    const validacion = validarRequisitosRestablecimiento(nuevaContrasena);
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

    // 2. Reglas que dependen de la cuenta. Van después de validar el código: antes, cualquiera
    // podría usar el mensaje "igual a la anterior" para adivinar la contraseña de otra persona.
    if (
      (await bcrypt.compare(nuevaContrasena, usuario.contrasena)) ||
      (await bcrypt.compare(nuevaContrasena.trim(), usuario.contrasena))
    ) {
      throw new BadRequestException(MENSAJE_CLAVE_IGUAL);
    }

    if (contieneDatosPersonales(nuevaContrasena, usuario.correo, usuario.nombre)) {
      throw new BadRequestException(MENSAJE_CLAVE_CON_DATOS_PERSONALES);
    }

    const salt = await bcrypt.genSalt(10);
    usuario.contrasena = await bcrypt.hash(nuevaContrasena, salt);

    usuario.codigoRecuperacion = '';
    usuario.expiracionCodigo = null as unknown as Date;

    await this.usuarioRepository.save(usuario);

    return { message: 'Contraseña actualizada correctamente.' };
  }
}
