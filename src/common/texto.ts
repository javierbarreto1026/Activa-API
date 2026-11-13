/**
 * Normaliza un texto para comparaciones: sin tildes, en minúsculas, sin espacios
 * sobrantes. "  Producción " y "produccion" producen lo mismo.
 * Equivale a la comparación que hace MySQL con las intercalaciones *_ci / *_ai_ci.
 */
export function normalizarTexto(valor: string | null | undefined): string {
  return (valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Convierte un texto en un segmento seguro para claves de Cloudflare R2 y URLs:
 * "Recursos Humanos" → "recursos-humanos", "Fichas técnicas 2026" → "fichas-tecnicas-2026".
 */
export function slug(valor: string, longitudMaxima = 60): string {
  const resultado = normalizarTexto(valor)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, longitudMaxima)
    .replace(/-+$/, '');
  return resultado || 'sin-nombre';
}
