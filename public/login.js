/* ==========================================================================
   Activa Uniformes · Portal de Gestión Documental · Inicio de sesión
   y restablecimiento de contraseña (login.html)
   ========================================================================== */

const API_BASE = window.location.origin;

const $ = (id) => document.getElementById(id);

$('anio').textContent = new Date().getFullYear();

// ---------- Utilidades de interfaz ----------

// Muestra un mensaje dentro de la tarjeta (reemplaza a alert). tipo: 'error' | 'ok'
function mostrarAviso(id, mensaje, tipo) {
    const el = $(id);
    // Nest devuelve un arreglo de mensajes cuando falla la validación del DTO.
    el.textContent = Array.isArray(mensaje) ? mensaje.join(' · ') : mensaje;
    el.className = 'notice notice--' + (tipo || 'error') + ' is-visible';
    // El aviso está al inicio de la tarjeta: en pantallas bajas quedaría fuera de la vista.
    el.scrollIntoView({ block: 'nearest' });
}

function ocultarAvisos() {
    ['avisoLogin', 'avisoReset'].forEach((id) => {
        const el = $(id);
        el.textContent = '';
        el.className = 'notice';
    });
}

// Estado de carga de un botón (deshabilita y muestra el indicador giratorio)
function cargando(btn, texto) {
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.textContent = texto;
}

function listo(btn, texto) {
    btn.disabled = false;
    btn.classList.remove('is-loading');
    btn.textContent = texto;
}

// Mostrar / ocultar contraseña (cada botón indica su campo en data-input)
function mostrarClave(btn, visible) {
    $(btn.dataset.input).type = visible ? 'text' : 'password';
    btn.classList.toggle('is-showing', visible);
    btn.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
}

// Alternar vistas entre Login y Restablecimiento
function toggleForms() {
    const irARestablecer = $('resetPanel').hidden;
    ocultarAvisos();

    $('loginPanel').hidden = irARestablecer;
    $('resetPanel').hidden = !irARestablecer;

    if (irARestablecer) {
        // Restablecer vista inicial de recuperación (Paso 1)
        $('formPaso1').hidden = false;
        $('formPaso2').hidden = true;
        $('resetSubtitulo').textContent = 'Ingresa tu correo para recibir un código de verificación';
        $('formPaso1').reset();
        listo($('btnEnviarCodigo'), 'Enviar código');
    }
    // También al salir: las claves escritas no deben quedar en los campos ocultos.
    limpiarPaso2();
}

// ---------- Requisitos de la nueva contraseña ----------

const LONGITUD_FRAGMENTO = 4;

function normalizar(texto) {
    return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Misma regla que contieneDatosPersonales en src/usuarios/politica-contrasena.ts: ningún
// fragmento de 4 caracteres de la parte local del correo, separada por números y símbolos.
function contieneParteDelCorreo(clave, correo) {
    const claveNormalizada = normalizar(clave);
    const tramos = normalizar(correo.split('@')[0]).match(/\p{L}+|\p{N}+/gu) || [];

    return tramos.some((tramo) => {
        for (let i = 0; i + LONGITUD_FRAGMENTO <= tramo.length; i++) {
            if (claveNormalizada.includes(tramo.slice(i, i + LONGITUD_FRAGMENTO))) return true;
        }
        return false;
    });
}

// Las claves coinciden con los data-regla de #listaRequisitosClave
const REGLAS_CLAVE = {
    longitud: (clave) => clave.length >= 8,
    mayuscula: (clave) => /[A-Z]/.test(clave),
    minuscula: (clave) => /[a-z]/.test(clave),
    numero: (clave) => /[0-9]/.test(clave),
    especial: (clave) => /[^A-Za-z0-9]/.test(clave),
    correo: (clave) => clave !== '' && !contieneParteDelCorreo(clave, $('resetEmail').value.trim()),
};

function pintarRequisitos(clave) {
    let todos = true;
    document.querySelectorAll('#listaRequisitosClave [data-regla]').forEach((item) => {
        const cumple = REGLAS_CLAVE[item.dataset.regla](clave);
        item.classList.toggle('is-ok', cumple);
        todos = todos && cumple;
    });
    return todos;
}

function pintarCoincidencia(clave, confirmacion) {
    const coincide = clave === confirmacion;
    const hayTexto = confirmacion !== '';
    const mensaje = $('mensajeCoincidencia');
    const input = $('confirmarContrasena');

    mensaje.hidden = !hayTexto;
    mensaje.textContent = !hayTexto ? '' : coincide ? 'Las contraseñas coinciden' : 'La contraseña no es igual';
    mensaje.classList.toggle('field-msg--ok', hayTexto && coincide);
    input.classList.toggle('is-invalid', hayTexto && !coincide);
    input.setAttribute('aria-invalid', String(hayTexto && !coincide));

    return hayTexto && coincide;
}

// Actualiza checklist, coincidencia y botón. Devuelve si el formulario se puede enviar.
function validarNuevaClave() {
    const clave = $('nuevaClave').value;
    const cumpleRequisitos = pintarRequisitos(clave);
    const coincide = pintarCoincidencia(clave, $('confirmarContrasena').value);
    const btn = $('btnCambiarClave');

    // Durante el envío el botón lo controla cargando().
    if (!btn.classList.contains('is-loading')) btn.disabled = !(cumpleRequisitos && coincide);
    return cumpleRequisitos && coincide;
}

function limpiarPaso2() {
    $('formPaso2').reset();
    // reset() vacía los campos, pero no vuelve a ocultar una clave que se estaba mostrando.
    document.querySelectorAll('#formPaso2 .toggle-pass').forEach((btn) => mostrarClave(btn, false));
    listo($('btnCambiarClave'), 'Actualizar clave');
    validarNuevaClave();
}

// 1. LÓGICA DE INICIO DE SESIÓN
async function procesarLogin(event) {
    event.preventDefault();
    ocultarAvisos();

    const correo = $('email').value.trim();
    const contrasena = $('password').value;
    const btn = $('btnSubmit');

    cargando(btn, 'Iniciando...');

    try {
        const res = await fetch(`${API_BASE}/usuarios/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo, contrasena })
        });

        const data = await res.json();

        if (!res.ok) {
            mostrarAviso('avisoLogin', data.message || 'Correo o contraseña incorrectos.', 'error');
            listo(btn, 'Iniciar sesión');
            return;
        }

        const token = data.token || data.access_token || data.accessToken || (data.usuario && data.usuario.token);
        const usuario = data.usuario || data.user || { correo };

        if (!token) {
            mostrarAviso('avisoLogin', 'El servidor no devolvió un token válido.', 'error');
            listo(btn, 'Iniciar sesión');
            return;
        }

        localStorage.setItem('token', token);
        localStorage.setItem('usuarioActiva', JSON.stringify({ ...usuario, token }));
        window.location.href = 'dashboard.html';

    } catch (err) {
        console.error('Error en login:', err);
        mostrarAviso('avisoLogin', 'Error de conexión con el servidor. Revisa que NestJS esté encendido.', 'error');
        listo(btn, 'Iniciar sesión');
    }
}

// 2. RECUPERACIÓN - PASO 1: Enviar Código por Correo
async function solicitarCodigo(event) {
    event.preventDefault();
    ocultarAvisos();

    const correo = $('resetEmail').value.trim();
    const btn = $('btnEnviarCodigo');

    cargando(btn, 'Enviando código...');

    try {
        const res = await fetch(`${API_BASE}/usuarios/solicitar-codigo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo })
        });

        const data = await res.json();

        if (!res.ok) {
            mostrarAviso('avisoReset', data.message || 'No se encontró una cuenta asociada a este correo.', 'error');
            listo(btn, 'Enviar código');
            return;
        }

        // Transición al Paso 2
        $('formPaso1').hidden = true;
        $('formPaso2').hidden = false;
        limpiarPaso2();
        $('resetSubtitulo').textContent = 'Ingresa el código enviado a ' + correo;
        mostrarAviso('avisoReset', '¡Código enviado con éxito! Revisa tu bandeja de entrada.', 'ok');
        $('codigoOTP').focus();

    } catch (err) {
        console.error('Error al enviar código:', err);
        mostrarAviso('avisoReset', 'Error de conexión con el servidor.', 'error');
        listo(btn, 'Enviar código');
    }
}

// 3. RECUPERACIÓN - PASO 2: Confirmar Código y Actualizar Clave
async function confirmarCambio(event) {
    event.preventDefault();
    if (!validarNuevaClave()) return;
    ocultarAvisos();

    const correo = $('resetEmail').value.trim();
    const codigo = $('codigoOTP').value.trim();
    const nuevaContrasena = $('nuevaClave').value;
    const btn = $('btnCambiarClave');

    // Tras un error, el botón vuelve a depender de los requisitos.
    const reactivar = () => {
        listo(btn, 'Actualizar clave');
        validarNuevaClave();
    };

    cargando(btn, 'Actualizando clave...');

    try {
        const res = await fetch(`${API_BASE}/usuarios/restablecer-contrasena`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo, codigo, nuevaContrasena })
        });

        const data = await res.json();

        if (!res.ok) {
            mostrarAviso('avisoReset', data.message || 'El código ingresado es incorrecto o ya expiró.', 'error');
            reactivar();
            return;
        }

        // Vuelve al login y confirma el cambio allí
        toggleForms();
        mostrarAviso('avisoLogin', '¡Contraseña actualizada con éxito! Ya puedes iniciar sesión.', 'ok');

    } catch (err) {
        console.error('Error al cambiar contraseña:', err);
        mostrarAviso('avisoReset', 'Error al intentar actualizar la contraseña.', 'error');
        reactivar();
    }
}

// ---------- Eventos ----------

$('loginForm').addEventListener('submit', procesarLogin);
$('formPaso1').addEventListener('submit', solicitarCodigo);
$('formPaso2').addEventListener('submit', confirmarCambio);

['nuevaClave', 'confirmarContrasena'].forEach((id) => {
    $(id).addEventListener('input', validarNuevaClave);
});

document.querySelectorAll('.btn-link').forEach((btn) => {
    btn.addEventListener('click', toggleForms);
});

document.querySelectorAll('.toggle-pass').forEach((btn) => {
    btn.addEventListener('click', () => mostrarClave(btn, !btn.classList.contains('is-showing')));
});
