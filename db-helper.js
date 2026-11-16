// db-helper.js — Mini-wrapper de IndexedDB (Tema 5.1 + actualizarEstadoRegistro del 5.2)
// Funciones globales (sin import/export): deben funcionar tanto por <script> como por importScripts() en el Service Worker.

const DB_NAME = 'pwa-outbox-db';
const DB_VERSION = 1;
const STORE_NAME = 'transacciones_pendientes';

// Abre (o crea) la base de datos.
// onupgradeneeded se dispara solo cuando la base no existe o sube de versión:
// ahí es donde creamos el object store (nada de eso puede hacerse fuera de ese evento).
function abrirDB(){
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

// Guarda un registro nuevo y resuelve con el id autoincremental generado.
function guardarRegistro(datos){
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite'); // readwrite = la transacción MODIFICA datos
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(datos);
      let idGenerado;
      req.onsuccess = (event) => { idGenerado = event.target.result; };
      // Resolve recién en tx.oncomplete: el id se conoce antes, pero la transacción
      // puede fallar después del onsuccess del request; confirmar acíncronamente
      // en oncomplete garantiza que la escritura quedó realmente aplicada.
      tx.oncomplete = () => resolve(idGenerado);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}

// Devuelve TODOS los registros del store (para pintar la bandeja de salida).
function obtenerTodosLosRegistros(){
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readonly'); // readonly = solo lectura, no hay riesgo de escritura
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = (event) => resolve(event.target.result);
      req.onerror = (event) => reject(event.target.error);
    });
  });
}

// Elimina un registro por su id (se usa al purgar los ya sincronizados).
function eliminarRegistro(id){
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}

// Actualiza el estado de un registro (pendiente -> sincronizado) y marca la fecha de sincronización.
function actualizarEstadoRegistro(id, nuevoEstado){
  return abrirDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const reqGet = store.get(id);
      reqGet.onsuccess = (event) => {
        const registro = event.target.result;
        if (!registro) {
          reject(new Error(`No se encontró el registro con ID: ${id}`));
          return;
        }
        registro.estado = nuevoEstado;
        registro.fechaSincronizacion = Date.now();
        store.put(registro);
      };
      // La put() se confirma recién al completarse la transacción:
      // recién ahí sabemos que el estado quedó persistido.
      tx.oncomplete = () => resolve(true);
      tx.onerror = (event) => reject(event.target.error);
    });
  });
}
