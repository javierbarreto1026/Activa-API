import { slug } from '../common/texto';
import { claveDocumento, prefijoCarpeta, reubicarClave } from './claves';

describe('claves de Cloudflare R2', () => {
  it('genera documentos/<area>/<carpetas>/<archivo>-<id>.<ext> con segmentos seguros', () => {
    const clave = claveDocumento(
      'Recursos Humanos',
      ['Contratos 2026', 'Año nuevo'],
      'Contrato Juan Pérez.PDF',
    );
    expect(clave).toMatch(
      /^documentos\/recursos-humanos\/contratos-2026\/ano-nuevo\/contrato-juan-perez-[0-9a-f]{8}\.pdf$/,
    );
  });

  it('sin carpeta, el documento queda en la raíz del área', () => {
    expect(prefijoCarpeta('Producción', [])).toBe('documentos/produccion');
  });

  it('dos subidas del mismo archivo no comparten clave', () => {
    expect(claveDocumento('Ventas', [], 'a.pdf')).not.toBe(claveDocumento('Ventas', [], 'a.pdf'));
  });

  it('los nombres no pueden escapar del prefijo', () => {
    expect(slug('../../etc')).toBe('etc');
    expect(slug('  ')).toBe('sin-nombre');
    expect(prefijoCarpeta('Ventas', ['..', '/'])).toBe('documentos/ventas/sin-nombre/sin-nombre');
  });

  it('al reubicar conserva el nombre del archivo y cambia el prefijo', () => {
    expect(
      reubicarClave('documentos/produccion/fichas/chaqueta-1a2b3c4d.jpg', 'Producción', [
        'Fichas técnicas',
      ]),
    ).toBe('documentos/produccion/fichas-tecnicas/chaqueta-1a2b3c4d.jpg');
  });
});
