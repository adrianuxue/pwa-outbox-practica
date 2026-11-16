// app.js — Lógica de la UI: red, Service Worker, Outbox y formularios (Temas 5.2 y 5.3)
// Sin palabras clave de concurrencia moderna: toda la asincronía se resuelve con Promesas (.then/.catch).

// ---------------------------------------------------------------------------
// a) Indicador de conexión
// ---------------------------------------------------------------------------
function actualizarIndicadorRed() {
  const badge = document.getElementById('badge-red');
  const enLinea = navigator.onLine;
  badge.textContent = enLinea ? 'En Línea' : 'Sin Conexión';
  badge.classList.toggle('online', enLinea);
  badge.classList.toggle('offline', !enLinea);
}

// ---------------------------------------------------------------------------
// b) Registro del Service Worker + escucha de mensajes desde el SW
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then((registro) => console.log('SW registrado:', registro.scope))
    .catch((error) => console.error('Error al registrar SW:', error));

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });
}

// ---------------------------------------------------------------------------
// c) Envío de un reporte: intenta POST directo; si falla, encola en Outbox
//    y registra la etiqueta de Background Sync (si el navegador la soporta).
// ---------------------------------------------------------------------------
function procesarEnvioReporte(datosFormulario) {
  const endpoint = 'https://jsonplaceholder.typicode.com/posts';
  return fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datosFormulario) })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => guardarRegistro({ ...datosFormulario, estado: 'sincronizado', fechaCreacion: Date.now() }))
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');
      return guardarRegistro({ ...datosFormulario, estado: 'pendiente', fechaCreacion: Date.now() })
        .then(() => {
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              });
          }
        });
    })
    .then(() => renderizarColaOutbox());
}

// ---------------------------------------------------------------------------
// d) Fallback de sincronización para navegadores SIN Background Sync:
//    reenvía a mano todos los registros pendientes al volver la conexión.
// ---------------------------------------------------------------------------
function sincronizarPendientesFallback() {
  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');
      if (pendientes.length === 0) {
        console.log('[Outbox] No hay registros pendientes para sincronizar.');
        return Promise.resolve([]);
      }
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch('https://jsonplaceholder.typicode.com/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        }).then((res) => {
          if (res.ok) {
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          }
          return null;
        });
      });
      return Promise.all(promesasDeEnvio);
    })
    .then(() => renderizarColaOutbox())
    .catch((error) => {
      console.error('[Outbox] Error en la sincronización fallback:', error);
    });
}

// ---------------------------------------------------------------------------
// e) Render de la bandeja de salida (Outbox) en la lista de la UI
// ---------------------------------------------------------------------------
function renderizarColaOutbox() {
  const lista = document.getElementById('lista-outbox');
  obtenerTodosLosRegistros()
    .then((registros) => {
      lista.innerHTML = '';

      if (registros.length === 0) {
        const liVacio = document.createElement('li');
        liVacio.classList.add('vacio');
        liVacio.textContent = 'Sin registros en la bandeja.';
        lista.appendChild(liVacio);
        return;
      }

      // Más recientes primero
      const ordenados = registros.slice().sort((a, b) => b.fechaCreacion - a.fechaCreacion);

      ordenados.forEach((registro) => {
        const li = document.createElement('li');
        li.classList.add(registro.estado === 'sincronizado' ? 'sincronizado' : 'pendiente');

        const titulo = document.createElement('span');
        titulo.classList.add('titulo');
        titulo.textContent = registro.titulo;

        const chip = document.createElement('span');
        chip.classList.add('chip', registro.estado);
        chip.textContent = registro.estado;

        const fecha = document.createElement('span');
        fecha.classList.add('fecha');
        fecha.textContent = new Date(registro.fechaCreacion).toLocaleString();

        li.appendChild(titulo);
        li.appendChild(chip);
        li.appendChild(fecha);
        lista.appendChild(li);
      });
    })
    .catch((error) => {
      console.error('[Outbox] Error al renderizar la bandeja:', error);
    });
}

// ---------------------------------------------------------------------------
// f) Envío del formulario: evita el POST nativo y delega en procesarEnvioReporte
// ---------------------------------------------------------------------------
document.getElementById('form-incidencia').addEventListener('submit', (e) => {
  e.preventDefault();
  const titulo = document.getElementById('titulo').value.trim();
  const descripcion = document.getElementById('descripcion').value.trim();
  procesarEnvioReporte({ titulo, descripcion }).then(() => {
    document.getElementById('form-incidencia').reset();
  });
});

// ---------------------------------------------------------------------------
// g) Purga: elimina de IndexedDB los registros ya sincronizados
// ---------------------------------------------------------------------------
document.getElementById('btn-purgar').addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
      if (sincronizados.length === 0) {
        console.log('[Outbox] No hay registros sincronizados para purgar.');
        return Promise.resolve();
      }
      return Promise.all(sincronizados.map((item) => eliminarRegistro(item.id)));
    })
    .then(() => renderizarColaOutbox())
    .catch((error) => {
      console.error('[Outbox] Error al purgar la bandeja:', error);
    });
});

// ---------------------------------------------------------------------------
// h) Eventos de red: si no hay SyncManager, reintentamos con fallback manual
// ---------------------------------------------------------------------------
window.addEventListener('online', () => {
  actualizarIndicadorRed();
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});
window.addEventListener('offline', actualizarIndicadorRed);

// ---------------------------------------------------------------------------
// i) Arranque de la UI
// ---------------------------------------------------------------------------
actualizarIndicadorRed();
renderizarColaOutbox();
