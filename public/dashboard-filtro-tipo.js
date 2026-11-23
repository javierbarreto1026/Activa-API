/* ==========================================================================
   Activa Uniformes · Panel · Filtro por tipo de archivo

   Compara la extensión del nombre con el tipo elegido en #filtroTipoArchivo
   (estado.tipo). filtrados() lo combina con el área, las fechas y la búsqueda,
   así que también se respeta al repintar desde dashboard-sync.js.

   Depende de lo que define el <script> principal de dashboard.html (que se
   carga antes): $, estado y render.
   ========================================================================== */

/** Extensiones de cada opción del selector ("todos" no figura: no filtra). */
const FILTRO_TIPOS = {
    pdf: { texto: 'PDF', extensiones: ['.pdf'] },
    word: { texto: 'de Word', extensiones: ['.doc', '.docx'] },
    excel: { texto: 'de Excel', extensiones: ['.xls', '.xlsx'] },
    powerpoint: { texto: 'de PowerPoint', extensiones: ['.ppt', '.pptx'] },
};

function coincideTipoArchivo(nombre, tipo) {
    const filtro = FILTRO_TIPOS[tipo];
    if (!filtro) return true;
    const enMinusculas = String(nombre ?? '').toLowerCase();
    return filtro.extensiones.some((ext) => enMinusculas.endsWith(ext));
}

function mensajeSinDocumentosDeTipo(tipo) {
    return `No hay documentos ${FILTRO_TIPOS[tipo].texto} con los filtros actuales`;
}

$('filtroTipoArchivo').addEventListener('change', (e) => {
    estado.tipo = e.target.value;
    estado.pagina = 1;
    render();
});
