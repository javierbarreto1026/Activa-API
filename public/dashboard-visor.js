/* ==========================================================================
   Activa Uniformes · Panel · Vista previa de documentos

   Muestra los documentos dentro de #modalVistaPrevia sin descargarlos:
   - PDF, TXT/CSV → iframe con la URL firmada "inline" de Backblaze B2.
   - Imágenes     → <img>.
   - Word, Excel, PowerPoint → visor embebido de Microsoft Office Online, que
     lee el archivo desde la URL firmada (caduca a los 15 min).
   La descarga está centralizada en el botón "Descargar" del modal.

   El backend (GET /documents/:id/vista-previa) responde con la URL firmada; si
   el servidor usa el respaldo local (sin B2), la URL es la ruta de descarga del
   backend y aquí se pide con el JWT (blob local).

   Depende de lo que define el <script> principal de dashboard.html (que se
   carga antes): $, tipoArchivo, authHeaders, cerrarSesion, mensajeError,
   descargarDocumento, API_BASE y API_DOCUMENTOS.
   ========================================================================== */

/** Visor según la extensión del archivo. */
const VISOR_EXTENSIONES = {
    pdf: ['pdf'],
    imagen: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    office: ['xls', 'xlsx', 'doc', 'docx', 'ppt', 'pptx'],
    texto: ['txt', 'csv'],
};
const VISOR_OFFICE_EMBED = 'https://view.officeapps.live.com/op/embed.aspx?src=';
const VISOR_OFFICE_COMPLETO = 'https://view.officeapps.live.com/op/view.aspx?src=';

const VISOR_ICO_NO_ADMITIDO = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9.5 13.5l5 5M14.5 13.5l-5 5"/></svg>';
const VISOR_ICO_ERROR = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
const VISOR_ICO_DESCARGAR = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>';

const estadoVisor = {
    id: null,
    nombre: '',
    /** URL de un blob local (respaldo sin B2): se libera al cerrar. */
    urlObjeto: null,
    /** Se incrementa al abrir/cerrar: descarta respuestas que llegan tarde. */
    peticion: 0,
};

const extensionDe = (nombre) => (String(nombre).includes('.') ? String(nombre).split('.').pop() : '').toLowerCase();

/** 'pdf' | 'imagen' | 'office' | 'texto' | null, según la extensión (o lo que diga el backend). */
function tipoDeVisor(info) {
    const ext = String(info.extension || extensionDe(estadoVisor.nombre)).toLowerCase();
    const porExtension = Object.keys(VISOR_EXTENSIONES).find((tipo) => VISOR_EXTENSIONES[tipo].includes(ext));
    return porExtension || info.visor || null;
}

/** Reemplaza el contenido del visor por un nodo o por HTML de un estado (carga, aviso...). */
function pintarVisor(contenido, clase = '') {
    const cont = $('contenedorVisor');
    cont.classList.remove('is-iframe', 'is-imagen');
    if (clase) cont.classList.add(clase);
    if (typeof contenido === 'string') cont.innerHTML = contenido;
    else cont.replaceChildren(contenido);
}

function pintarCargandoVisor() {
    pintarVisor('<div class="visor-estado" role="status"><span class="visor-spinner" aria-hidden="true"></span><p>Cargando vista previa…</p></div>');
}

/** Aviso centrado con botón de descarga (formatos sin vista previa o errores). */
function pintarMensajeVisor(icono, titulo, texto) {
    const caja = document.createElement('div');
    caja.className = 'visor-estado';
    caja.innerHTML = `<span class="visor-estado-ico">${icono}</span><h3></h3><p></p>`
        + `<button type="button" class="btn-primary" data-visor-descargar>${VISOR_ICO_DESCARGAR}Descargar archivo</button>`;
    caja.querySelector('h3').textContent = titulo;
    caja.querySelector('p').textContent = texto;
    pintarVisor(caja);
}

function pintarNoAdmitidoVisor() {
    pintarMensajeVisor(VISOR_ICO_NO_ADMITIDO, 'Este formato no tiene vista previa disponible',
        'Descarga el archivo para abrirlo con la aplicación correspondiente.');
}

/** Habilita "Abrir en pestaña" con la URL dada (o lo deshabilita con null). */
function enlacePestanaVisor(url) {
    const a = $('btnVisorPestana');
    if (url) {
        a.href = url;
        a.removeAttribute('aria-disabled');
        a.removeAttribute('tabindex');
    } else {
        a.removeAttribute('href');
        a.setAttribute('aria-disabled', 'true');
        a.setAttribute('tabindex', '-1');
    }
}

function crearIframeVisor(src, claseExtra = '') {
    const iframe = document.createElement('iframe');
    iframe.className = `visor-iframe ${claseExtra}`.trim();
    iframe.src = src;
    iframe.title = `Vista previa de ${estadoVisor.nombre}`;
    return iframe;
}

function mostrarPdf(url) {
    // Navegadores sin visor de PDF integrado (p. ej. Chrome en Android) descargarían el
    // archivo desde el iframe: en su lugar se ofrece abrirlo en una pestaña.
    if (navigator.pdfViewerEnabled === false) {
        const caja = document.createElement('div');
        caja.className = 'visor-estado';
        caja.innerHTML = `<span class="visor-estado-ico">${VISOR_ICO_NO_ADMITIDO}</span>`
            + '<h3>Tu navegador no muestra PDF dentro de la página</h3>'
            + '<p>Ábrelo en una pestaña nueva para verlo sin descargarlo.</p>'
            + '<a class="btn-primary" target="_blank" rel="noopener">Abrir en pestaña</a>';
        caja.querySelector('a').href = url;
        pintarVisor(caja);
        return;
    }
    pintarVisor(crearIframeVisor(url), 'is-iframe');
}

function mostrarImagen(url, peticion) {
    const img = document.createElement('img');
    img.className = 'visor-imagen';
    img.alt = estadoVisor.nombre;
    img.decoding = 'async';
    // Se mantiene el "cargando" hasta que la imagen llega, para no mostrar un cuadro vacío.
    img.addEventListener('load', () => {
        if (peticion === estadoVisor.peticion) pintarVisor(img, 'is-imagen');
    }, { once: true });
    img.addEventListener('error', () => {
        if (peticion !== estadoVisor.peticion) return;
        pintarMensajeVisor(VISOR_ICO_ERROR, 'No se pudo mostrar la imagen', 'Vuelve a intentarlo o descarga el archivo.');
    }, { once: true });
    img.src = url;
}

/** Word, Excel y PowerPoint: visor de Microsoft Office Online sobre la URL firmada de B2. */
function mostrarOffice(url) {
    const src = encodeURIComponent(url);
    pintarVisor(crearIframeVisor(VISOR_OFFICE_EMBED + src), 'is-iframe');
    enlacePestanaVisor(VISOR_OFFICE_COMPLETO + src); // en pestaña, el visor completo de Office
}

/** Respaldo local (sin B2): el contenido se pide con el JWT y se muestra como blob. */
async function urlConToken(info, tipo, peticion) {
    const res = await fetch(new URL(info.url, API_BASE), { headers: authHeaders() });
    if (res.status === 401) { cerrarSesion(); return null; }
    if (!res.ok) throw new Error(await mensajeError(res, 'No se pudo obtener el archivo.'));
    const blob = await res.blob();
    if (peticion !== estadoVisor.peticion) return null;
    // El tipo correcto hace que el navegador use su visor (PDF, imagen o texto).
    const tipoBlob = tipo === 'texto' ? 'text/plain; charset=utf-8' : info.mimeType;
    estadoVisor.urlObjeto = URL.createObjectURL(new Blob([blob], { type: tipoBlob }));
    return estadoVisor.urlObjeto;
}

async function abrirVistaPrevia(id, nombre) {
    liberarVisor();
    const peticion = ++estadoVisor.peticion;
    estadoVisor.id = id;
    estadoVisor.nombre = nombre || 'Documento';

    const t = tipoArchivo(estadoVisor.nombre);
    $('visorTipo').className = `file-ico ${t.clase}`;
    $('visorTipo').textContent = t.ext;
    $('visorTitulo').textContent = estadoVisor.nombre;
    $('visorTitulo').title = estadoVisor.nombre;
    pintarCargandoVisor();

    const dlg = $('modalVistaPrevia');
    if (!dlg.open) dlg.showModal();

    try {
        const res = await fetch(`${API_DOCUMENTOS}/${encodeURIComponent(id)}/vista-previa`, { headers: authHeaders() });
        if (res.status === 401) { cerrarSesion(); return; }
        if (!res.ok) throw new Error(await mensajeError(res, 'No se pudo cargar la vista previa.'));
        const info = await res.json();
        if (peticion !== estadoVisor.peticion) return; // se cerró o se abrió otro documento

        const tipo = tipoDeVisor(info);
        if (!tipo || !info.url) { pintarNoAdmitidoVisor(); return; }

        // Office Online descarga el archivo desde los servidores de Microsoft: necesita una URL
        // pública (la firmada de B2). La ruta local del backend exige el JWT y no le sirve.
        if (tipo === 'office' && info.requiereToken) {
            pintarMensajeVisor(VISOR_ICO_NO_ADMITIDO, 'Vista previa no disponible en este servidor',
                'Los documentos de Office se previsualizan solo cuando se guardan en la nube. Descárgalo para abrirlo.');
            return;
        }

        const url = info.requiereToken ? await urlConToken(info, tipo, peticion) : info.url;
        if (!url || peticion !== estadoVisor.peticion) return;

        enlacePestanaVisor(url);
        if (tipo === 'pdf') mostrarPdf(url);
        else if (tipo === 'imagen') mostrarImagen(url, peticion);
        else if (tipo === 'office') mostrarOffice(url);
        else pintarVisor(crearIframeVisor(url, 'visor-texto'), 'is-iframe');
    } catch (err) {
        if (peticion !== estadoVisor.peticion) return;
        console.error('Error en la vista previa:', err);
        pintarMensajeVisor(VISOR_ICO_ERROR, 'No se pudo cargar la vista previa', err.message || 'Inténtalo de nuevo más tarde.');
    }
}

/** Vacía el visor (detiene el iframe / la imagen) y libera el blob local, si lo hay. */
function liberarVisor() {
    estadoVisor.peticion++;
    pintarVisor('');
    enlacePestanaVisor(null);
    if (estadoVisor.urlObjeto) {
        URL.revokeObjectURL(estadoVisor.urlObjeto);
        estadoVisor.urlObjeto = null;
    }
}

function cerrarVistaPrevia() {
    const dlg = $('modalVistaPrevia');
    if (dlg.open) dlg.close(); // el evento "close" hace la limpieza
}

/** Descarga directa (attachment) por el backend, protegida por el JWT. */
function descargarDesdeVisor() {
    if (estadoVisor.id !== null) descargarDocumento(estadoVisor.id, estadoVisor.nombre);
}

(function iniciarVisor() {
    const dlg = $('modalVistaPrevia');

    // Botón del ojo en la tabla (las filas se repintan: delegación en el panel)
    document.querySelector('.panel').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-ver]');
        if (btn) abrirVistaPrevia(btn.dataset.ver, btn.dataset.nombre);
    });

    $('btnCerrarVisor').addEventListener('click', cerrarVistaPrevia);
    $('btnVisorDescargar').addEventListener('click', descargarDesdeVisor);
    $('btnVisorPestana').addEventListener('click', (e) => {
        if (e.currentTarget.getAttribute('aria-disabled') === 'true') e.preventDefault();
    });
    $('contenedorVisor').addEventListener('click', (e) => {
        if (e.target.closest('[data-visor-descargar]')) descargarDesdeVisor();
    });

    // Clic fuera del cuadro (sobre el fondo del <dialog>)
    dlg.addEventListener('click', (e) => { if (e.target === dlg) cerrarVistaPrevia(); });

    // Escape lo gestiona el propio <dialog>; cualquier cierre pasa por aquí.
    dlg.addEventListener('close', () => {
        liberarVisor();
        estadoVisor.id = null;
    });
})();
