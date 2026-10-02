// Firestore no tiene búsqueda de texto parcial ni filtros combinados libres.
// Con 50–500 clientes lo más simple es leer la colección, guardarla en memoria y filtrar/ordenar aquí.
//
// En un hosting "serverless" (Vercel) cada petición puede caer en una instancia distinta,
// así que cada instancia valida su copia con UN documento (meta/clientes) que lleva un contador
// de versión: 1 lectura por petición en lugar de releer todos los clientes. Cada escritura de un
// cliente sube el contador, y todas las instancias se enteran en su próxima petición.
const { FieldValue } = require('firebase-admin/firestore');
const { db, aObjeto } = require('./db');

const MAX_EDAD_MS = 10 * 60 * 1000; // por seguridad, se relee al menos cada 10 minutos
const meta = () => db.collection('meta').doc('clientes');

let cache = null;
let version = null;
let cargadoEn = 0;

async function todosLosClientes() {
  // La versión se lee ANTES que los datos: si alguien escribe en el medio, la próxima vez se relee.
  const doc = await meta().get();
  const actual = doc.exists ? doc.data().version : 0;
  if (!cache || actual !== version || Date.now() - cargadoEn > MAX_EDAD_MS) {
    const snap = await db.collection('clientes').get();
    cache = snap.docs.map(aObjeto);
    version = actual;
    cargadoEn = Date.now();
  }
  return cache;
}

async function invalidar() {
  cache = null;
  await meta().set({ version: FieldValue.increment(1) }, { merge: true });
}

module.exports = { todosLosClientes, invalidar };
