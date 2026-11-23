import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { MailerService } from '@nestjs-modules/mailer';
import { Repository } from 'typeorm';
import { jest } from '@jest/globals';
import * as bcrypt from 'bcryptjs';
import type { Usuario } from './usuario.entity';
import type { AuditService } from '../audit/audit.service';
import type * as ModServicio from './usuarios.service.js';

// Ver usuarios.service.spec.ts: el mailer (CommonJS) se simula antes de importar el servicio.
jest.unstable_mockModule('@nestjs-modules/mailer', () => ({ MailerService: class {} }));

const CORREO = 'javierbarreto1026@gmail.com';
const CODIGO = '482913';
const CLAVE_ACTUAL = 'Zxcvbn9!';
const HASH_ACTUAL = bcrypt.hashSync(CLAVE_ACTUAL, 4);

interface Correo {
  subject: string;
  html: string;
}

describe('UsuariosService: restablecer contraseña', () => {
  let usuario: Partial<Usuario>;
  let save: jest.Mock<(u: Partial<Usuario>) => Promise<unknown>>;
  let sendMail: jest.Mock<(c: Correo) => Promise<void>>;
  let service: InstanceType<typeof ModServicio.UsuariosService>;

  beforeEach(async () => {
    const { UsuariosService } = (await import('./usuarios.service.js')) as typeof ModServicio;
    usuario = {
      id: 5,
      nombre: 'Camila Rojas',
      correo: CORREO,
      contrasena: HASH_ACTUAL,
      codigoRecuperacion: CODIGO,
      expiracionCodigo: new Date(Date.now() + 60_000),
    };
    save = jest.fn((u) => Promise.resolve(u));
    sendMail = jest.fn(() => Promise.resolve());
    service = new UsuariosService(
      { findOne: () => Promise.resolve(usuario), save } as unknown as Repository<Usuario>,
      {} as ConfigService,
      {} as JwtService,
      { sendMail } as unknown as MailerService,
      {} as AuditService,
    );
  });

  const restablecer = (clave: string, codigo = CODIGO) =>
    service.restablecerContrasena(CORREO, codigo, clave);

  it('guarda la nueva clave cifrada e invalida el código', async () => {
    await restablecer('Qwpoiu7$');

    expect(save).toHaveBeenCalledTimes(1);
    expect(await bcrypt.compare('Qwpoiu7$', usuario.contrasena!)).toBe(true);
    expect(usuario.codigoRecuperacion).toBe('');
  });

  it.each([
    [
      'sin carácter especial',
      'Qwpoiu77',
      'La contraseña debe contener al menos un carácter especial.',
    ],
    ['igual a la anterior', CLAVE_ACTUAL, 'La nueva contraseña no puede ser igual a la anterior'],
    [
      'igual a la anterior con espacios',
      ` ${CLAVE_ACTUAL} `,
      'La nueva contraseña no puede ser igual a la anterior',
    ],
    [
      'con parte del correo',
      'Barreto#77',
      'La contraseña no puede contener partes de tu correo electrónico o nombre',
    ],
    [
      'con parte del nombre',
      'Camila#77',
      'La contraseña no puede contener partes de tu correo electrónico o nombre',
    ],
  ])('rechaza una clave %s sin gastar el código', async (_, clave, mensaje) => {
    await expect(restablecer(clave)).rejects.toMatchObject({ status: 400, message: mensaje });
    expect(save).not.toHaveBeenCalled();
    expect(usuario.codigoRecuperacion).toBe(CODIGO);
  });

  it('con un código incorrecto no revela si la clave es la actual', async () => {
    await expect(restablecer(CLAVE_ACTUAL, '000000')).rejects.toThrow(
      'El código ingresado es incorrecto.',
    );
  });

  it('el código no aparece en el asunto ni en la vista previa del correo', async () => {
    await service.solicitarCodigoRecuperacion(CORREO);

    const { subject, html } = sendMail.mock.calls[0][0];
    const codigo = usuario.codigoRecuperacion!;
    expect(codigo).toMatch(/^\d{6}$/);
    expect(subject).toBe('Solicitud de restablecimiento de contraseña | Activa Uniformes');

    const [, despuesDeBody] = html.split(/<body[^>]*>/);
    expect(despuesDeBody.trimStart()).toMatch(
      /^<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">Has solicitado restablecer tu contraseña en el Portal de Gestión Documental\. Abre este mensaje para consultar tu código de verificación\.(&zwnj;&nbsp;){100,}<\/div>/,
    );
    // El código sigue en el cuerpo, después del preheader.
    expect(html.indexOf(codigo)).toBeGreaterThan(html.indexOf('</div>'));
  });
});
