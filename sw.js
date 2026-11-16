// sw.js — Service Worker: caché estática + Background Sync del Outbox (Tema 5.3)
// Trae las funciones de IndexedDB desde db-helper.js (mismas funciones globales que usa la UI).
importScripts('./db-helper.js');

const CACHE_STATIC_NAME = 'static-outbox-v2';
const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json',
  './icon.svg'
];

// Install: precachea los archivos estáticos y deja que la página de control se active ya
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC_NAME)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

// Activate: elimina versiones viejas de la caché y toma el control de las páginas
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nombresDeCache) => {
        return Promise.all(
          nombresDeCache
            .filter((nombre) => nombre.startsWith('static-outbox-') && nombre !== CACHE_STATIC_NAME)
            .map((nombre) => caches.delete(nombre))
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: primero caché, luego red; si ambos fallan, la página (fallback offline)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((resp) => {
      return resp || fetch(event.request).catch(() => caches.match('./index.html'));
    })
  );
});

// Fragment B: avisa a todas las ventanas abiertas que la bandeja se sincronizó
function notificarClientesActualizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => {
      clientes.forEach((cliente) => {
        cliente.postMessage({ tipo: 'OUTBOX_SINCRONIZADO', timestamp: Date.now() });
      });
    });
}

// Fragment C: reenvía los registros pendientes y los marca como sincronizados
function sincronizarPendientesSW() {
  return obtenerTodosLosRegistros().then((registros) => {
    const pendientes = registros.filter((item) => item.estado === 'pendiente');
    if (pendientes.length === 0) {
      console.log('[SW] No hay registros pendientes para sincronizar.');
      return;
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
    return Promise.all(promesasDeEnvio)
      .then(() => notificarClientesActualizacion());
  });
}

// Fragment D: el navegador dispara este evento al volver la conexión
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-reportes') {
    event.waitUntil(
      sincronizarPendientesSW().catch((error) => {
        console.error('[SW] Error al sincronizar pendientes:', error);
        throw error;
      })
    );
  }
});
