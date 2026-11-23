import { contieneDatosPersonales, validarRequisitosRestablecimiento } from './politica-contrasena';

describe('validarRequisitosRestablecimiento', () => {
  it.each([
    ['Ab1!xyz', '8 caracteres'],
    ['zxcvbn9!k', 'mayúscula'],
    ['ZXCVBN9!K', 'minúscula'],
    ['Zxcvbnm!k', 'número'],
    ['Zxcvbnm9k', 'carácter especial'],
  ])('rechaza "%s" (falta: %s)', (clave, motivo) => {
    const r = validarRequisitosRestablecimiento(clave);
    expect(r.valida).toBe(false);
    expect(r.mensaje).toContain(motivo);
  });

  it('acepta una clave que cumple los cinco requisitos', () => {
    expect(validarRequisitosRestablecimiento('Zxcvbn9!')).toEqual({ valida: true });
  });
});

describe('contieneDatosPersonales', () => {
  const CORREO = 'javierbarreto1026@gmail.com';

  it.each(['Javier#2024', 'xBARRETO#9', 'Clave$1026', 'Javierbarreto#1', 'Jávier#2024'])(
    'rechaza "%s" por el correo, sin importar mayúsculas ni tildes',
    (clave) => {
      expect(contieneDatosPersonales(clave, CORREO, 'Admin')).toBe(true);
    },
  );

  it('separa la parte local por símbolos e ignora el dominio', () => {
    expect(contieneDatosPersonales('Perez#2024', 'ana.perez@empresa.com', '')).toBe(true);
    expect(contieneDatosPersonales('Empresa#2024', 'ana.perez@empresa.com', '')).toBe(false);
  });

  it('rechaza palabras del nombre, con o sin tilde', () => {
    expect(contieneDatosPersonales('Gomez#2024', 'kg@empresa.com', 'Karla Gómez')).toBe(true);
    expect(contieneDatosPersonales('xKARLA#2024', 'kg@empresa.com', 'Karla Gómez')).toBe(true);
  });

  it('ignora fragmentos de menos de 4 caracteres', () => {
    expect(contieneDatosPersonales('Ana#Leo12', 'ana12@empresa.com', 'Ana Leo')).toBe(false);
  });

  it('acepta una clave sin relación con el usuario', () => {
    expect(contieneDatosPersonales('Zxcvbn9!', CORREO, 'Javier Barreto')).toBe(false);
  });
});
