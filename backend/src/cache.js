// Firestore no tiene búsqueda de texto parcial ni filtros combinados libres.
// Con 50–500 clientes lo más simple y barato es leer la colección una vez,
// guardarla en memoria y filtrar/ordenar aquí. Se invalida en cada escritura
// y vence a los 60 s (por si hubiera más de una instancia del servidor).
const { db, aObjeto } = require('./db');

const TTL_MS = 60 * 1000;
let cache = null;
let cargadoEn = 0;

async function todosLosClientes() {
  if (!cache || Date.now() - cargadoEn > TTL_MS) {
    const snap = await db.collection('clientes').get();
    cache = snap.docs.map(aObjeto);
    cargadoEn = Date.now();
  }
  return cache;
}

function invalidar() {
  cache = null;
}

module.exports = { todosLosClientes, invalidar };
