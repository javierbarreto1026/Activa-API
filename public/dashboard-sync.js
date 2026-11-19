/* ==========================================================================
   Activa Uniformes · Panel · Actualización automática silenciosa (polling)

   Cada 10 s vuelve a consultar documentos, carpetas y (administradores) la
   campana de auditoría, y repinta solo si algo cambió. No toca el estado de
   navegación del usuario (área, carpeta abierta, búsqueda, fechas, orden,
   página) ni los modales abiertos, y no muestra esqueletos de carga.

   Depende de lo que define el <script> principal de dashboard.html (que se
   carga antes): estado, render, normalizarDoc, normalizarCarpeta, carpetaPorId,
   authHeaders, window.actualizarContadorNotificaciones, API_DOCUMENTOS, API_CARPETAS y $.
   ========================================================================== */

const INTERVALO_SINCRONIZACION_MS = 10000;

let intervaloSincronizacion = null;
let estaSincronizando = false;

// Zonas que render() vuelve a dibujar: si el foco del teclado estaba en una, se recupera
const ZONAS_REPINTADAS = ['tabs', 'migas', 'carpetas', 'tbody', 'paginacion', 'estado'];

function hayToken() {
    try { return !!localStorage.getItem('token'); } catch { return false; }
}

function iniciarActualizacionAutomatica() {
    if (intervaloSincronizacion !== null) return; // nunca dos intervalos a la vez
    if (!hayToken()) return;
    intervaloSincronizacion = setInterval(sincronizarDatosSilenciosamente, INTERVALO_SINCRONIZACION_MS);
}

function detenerActualizacionAutomatica() {
    if (intervaloSincronizacion === null) return;
    clearInterval(intervaloSincronizacion);
    intervaloSincronizacion = null;
}

async function sincronizarDatosSilenciosamente() {
    if (estaSincronizando || document.hidden) return; // sin peticiones solapadas ni con la pestaña oculta
    if (!hayToken()) { detenerActualizacionAutomatica(); return; }

    estaSincronizando = true;
    try {
        // Documentos y campana en paralelo; un fallo en una no bloquea a la otra
        await Promise.allSettled([sincronizarDocumentos(), sincronizarNotificaciones()]);
    } finally {
        estaSincronizando = false;
    }
}

/** Campana de auditoría: solo si el usuario es administrador (botón visible). */
async function sincronizarNotificaciones() {
    const campana = document.getElementById('btnAuditoria');
    if (!campana || campana.hidden) return;
    if (typeof window.actualizarContadorNotificaciones !== 'function') return;
    try {
        await window.actualizarContadorNotificaciones();
    } catch (err) {
        console.warn('No se pudo actualizar el contador de notificaciones (se reintentará):', err);
    }
}

async function sincronizarDocumentos() {
    // Una carga visible (cargar()) en curso ya traerá datos frescos
    if (estado.cargando) return;
    const docsAntes = estado.docs;
    const carpetasAntes = estado.carpetas;

    try {
        const [resDocs, resCarpetas] = await Promise.all([
            fetch(API_DOCUMENTOS, { headers: authHeaders() }),
            fetch(API_CARPETAS, { headers: authHeaders() }),
        ]);
        if (resDocs.status === 401 || resCarpetas.status === 401) { detenerActualizacionAutomatica(); return; }
        if (!resDocs.ok || !resCarpetas.ok) return; // fallo puntual: se conserva lo que ya se ve

        const data = await resDocs.json();
        const lista = Array.isArray(data) ? data : (data.documentos || data.data || []);
        const docs = lista.map(normalizarDoc);
        const carpetas = (await resCarpetas.json()).map(normalizarCarpeta);

        // Si mientras tanto una subida/eliminación recargó con cargar(), sus datos son igual o más recientes
        if (estado.cargando || estado.docs !== docsAntes || estado.carpetas !== carpetasAntes) return;

        // Sin cambios no se repinta: ni parpadeos ni pérdida de foco
        const sinCambios = !estado.error
            && JSON.stringify(docs) === JSON.stringify(estado.docs)
            && JSON.stringify(carpetas) === JSON.stringify(estado.carpetas);
        if (sinCambios) return;

        estado.docs = docs;
        estado.carpetas = carpetas;
        estado.error = false; // si la carga inicial había fallado, se recupera sola
        // Si otro usuario eliminó la carpeta abierta, se vuelve a la raíz del área (igual que cargar())
        if (estado.carpeta !== null && !carpetaPorId(estado.carpeta)) estado.carpeta = null;

        const foco = capturarFoco();
        render(); // conserva área, búsqueda, fechas y página (solo la ajusta si ya no existe)
        restaurarFoco(foco);
    } catch (err) {
        console.warn('Sincronización automática fallida (se reintentará):', err);
    }
}

/** Identifica el elemento enfocado por sus atributos data-* para volver a enfocarlo tras repintar. */
function capturarFoco() {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const zona = ZONAS_REPINTADAS.find(id => $(id)?.contains(el));
    if (!zona) return null;
    const datos = [...el.attributes].filter(a => a.name.startsWith('data-'));
    if (!datos.length) return null;
    return {
        zona,
        selector: datos.map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join(''),
        texto: el.textContent,
    };
}

function restaurarFoco(foco) {
    if (!foco || (document.activeElement && document.activeElement !== document.body)) return;
    const candidatos = [...($(foco.zona)?.querySelectorAll(foco.selector) || [])];
    const el = candidatos.find(c => c.textContent === foco.texto) || candidatos[0];
    el?.focus({ preventScroll: true });
}

// Al volver a la pestaña: sincronización inmediata (si el polling sigue activo)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && intervaloSincronizacion !== null) sincronizarDatosSilenciosamente();
});
