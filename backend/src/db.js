// Conexión a Firestore (Firebase Admin SDK).
// - Desarrollo/tests: si existe FIRESTORE_EMULATOR_HOST se usa el emulador local.
// - Producción: FIREBASE_SERVICE_ACCOUNT con el JSON de la cuenta de servicio
//   (o la ruta a ese archivo). Solo el servidor accede a la base; las reglas
//   de firestore.rules bloquean todo acceso directo desde internet.
const fs = require('fs');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

function iniciar() {
  if (getApps().length) return;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'demo-clientes' });
    return;
  }
  const origen = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!origen) {
    throw new Error('Falta FIREBASE_SERVICE_ACCOUNT (JSON o ruta al archivo de la cuenta de servicio)');
  }
  const json = origen.trim().startsWith('{') ? origen : fs.readFileSync(origen, 'utf8');
  initializeApp({ credential: cert(JSON.parse(json)) });
}

iniciar();
const db = getFirestore();

// Convierte un documento en objeto plano: { id, ...campos } con fechas como Date.
function aObjeto(doc) {
  const datos = doc.data();
  for (const k of Object.keys(datos)) {
    if (datos[k] && typeof datos[k].toDate === 'function') datos[k] = datos[k].toDate();
  }
  return { id: doc.id, ...datos };
}

module.exports = { db, aObjeto };
