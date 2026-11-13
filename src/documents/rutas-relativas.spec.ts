import { BadRequestException } from '@nestjs/common';
import { parsearRutas } from './rutas-relativas';

describe('parsearRutas (carga masiva)', () => {
  it('separa carpetas y archivo de cada ruta relativa', () => {
    const rutas = parsearRutas(
      JSON.stringify(['Contratos/2026/contrato.pdf', 'Contratos\\cedula.jpg', 'suelto.pdf']),
      3,
    );
    expect(rutas.map((r) => [r.carpetas, r.archivo])).toEqual([
      [['Contratos', '2026'], 'contrato.pdf'],
      [['Contratos'], 'cedula.jpg'],
      [[], 'suelto.pdf'],
    ]);
  });

  it('corrige nombres de carpeta con caracteres no permitidos', () => {
    const [ruta] = parsearRutas(JSON.stringify(['Fac:turas*/a.pdf']), 1);
    expect(ruta.carpetas).toEqual(['Fac-turas-']);
  });

  it('rechaza rutas con ".." (path traversal)', () => {
    expect(() => parsearRutas(JSON.stringify(['Contratos/../../a.pdf']), 1)).toThrow(
      BadRequestException,
    );
  });

  it('exige una ruta por archivo y JSON válido', () => {
    expect(() => parsearRutas(JSON.stringify(['a.pdf']), 2)).toThrow(BadRequestException);
    expect(() => parsearRutas('no es json', 1)).toThrow(BadRequestException);
    expect(() => parsearRutas(JSON.stringify([1]), 1)).toThrow(BadRequestException);
    expect(() => parsearRutas(undefined, 1)).toThrow(BadRequestException);
  });
});
