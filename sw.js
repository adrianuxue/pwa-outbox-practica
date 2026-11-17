importScripts('./db-helper.js');

const CACHE_STATIC_NAME = 'static-outbox-v3';
const STATIC_FILES = [
  './',
  './index.html',
  './styles.css',
  './db-helper.js',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC_NAME)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

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

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((resp) => {
      return resp || fetch(event.request).catch(() => caches.match('./index.html'));
    })
  );
});

function notificarClientesActualizacion() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => {
      clientes.forEach((cliente) => {
        cliente.postMessage({ tipo: 'OUTBOX_SINCRONIZADO', timestamp: Date.now() });
      });
    });
}

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
        if (!res.ok) {
          throw new Error(`Error HTTP ${res.status} al sincronizar ID ${item.id}`);
        }
        return actualizarEstadoRegistro(item.id, 'sincronizado');
      });
    });
    return Promise.all(promesasDeEnvio)
      .then(() => notificarClientesActualizacion());
  });
}

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
