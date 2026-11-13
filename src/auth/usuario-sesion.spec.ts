import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  departamentoParaEscritura,
  departamentoParaLectura,
  esAdmin,
  mismoDepartamento,
  puedeAcceder,
  type UsuarioSesion,
} from './usuario-sesion';
import { canonizarDepartamento, DEPARTAMENTOS } from '../common/departamentos';

const usuario = (rol: string, departamento: string): UsuarioSesion => ({
  id: 1,
  nombre: 'Prueba',
  correo: 'prueba@empresa.com',
  rol,
  departamento,
});

const admin = usuario(' Administrador ', 'Gerencia');
const sst = usuario('USUARIO ', 'SST');

describe('áreas de la empresa', () => {
  it('solo existen las cuatro áreas oficiales', () => {
    expect(DEPARTAMENTOS).toEqual(['Contabilidad', 'Recursos Humanos', 'SST', 'Gerencia']);
  });

  it('canoniza mayúsculas, tildes y espacios, y rechaza áreas que no existen', () => {
    expect(canonizarDepartamento(' recursos  humanos ')).toBe('Recursos Humanos');
    expect(canonizarDepartamento('sst')).toBe('SST');
    expect(canonizarDepartamento('Producción')).toBeNull();
    expect(canonizarDepartamento('')).toBeNull();
  });
});

describe('control de acceso por área', () => {
  it('reconoce los roles de administrador sin distinguir mayúsculas ni espacios', () => {
    expect(esAdmin(admin)).toBe(true);
    expect(esAdmin(usuario('admin', 'Contabilidad'))).toBe(true);
    expect(esAdmin(sst)).toBe(false);
  });

  it('compara áreas sin distinguir tildes ni mayúsculas', () => {
    expect(mismoDepartamento('Recursos Humanos', ' recursos humanos ')).toBe(true);
    expect(mismoDepartamento('SST', 'Contabilidad')).toBe(false);
    expect(mismoDepartamento('', '')).toBe(false);
  });

  it('lectura: el administrador ve todo o filtra; el resto solo su área', () => {
    expect(departamentoParaLectura(admin)).toBeUndefined();
    expect(departamentoParaLectura(admin, 'contabilidad')).toBe('Contabilidad');
    expect(() => departamentoParaLectura(admin, 'Producción')).toThrow(BadRequestException);
    expect(departamentoParaLectura(sst)).toBe('SST');
    expect(departamentoParaLectura(sst, 'sst')).toBe('SST');
    expect(() => departamentoParaLectura(sst, 'Contabilidad')).toThrow(ForbiddenException);
  });

  it('escritura: siempre devuelve el nombre oficial del área', () => {
    expect(departamentoParaEscritura(sst)).toBe('SST');
    expect(departamentoParaEscritura(usuario('usuario', 'recursos humanos'))).toBe(
      'Recursos Humanos',
    );
    expect(() => departamentoParaEscritura(sst, 'Recursos Humanos')).toThrow(ForbiddenException);
    expect(departamentoParaEscritura(admin, 'Recursos Humanos')).toBe('Recursos Humanos');
    expect(() => departamentoParaEscritura(admin, 'Ventas')).toThrow(BadRequestException);
    expect(() => departamentoParaEscritura(admin)).toThrow(BadRequestException);
  });

  it('una cuenta sin área, o con un área que ya no existe, no puede consultar ni escribir', () => {
    for (const cuenta of [usuario('usuario', ''), usuario('usuario', 'Producción')]) {
      expect(() => departamentoParaLectura(cuenta)).toThrow(ForbiddenException);
      expect(() => departamentoParaEscritura(cuenta)).toThrow(ForbiddenException);
    }
    expect(puedeAcceder(usuario('usuario', ''), '')).toBe(false);
  });
});
