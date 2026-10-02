// Conexión a Firestore (Firebase Admin SDK).
// - Desarrollo/tests: si existe FIRESTORE_EMULATOR_HOST se usa el emulador local.
// - Producción: FIREBASE_SERVICE_ACCOUNT con el JSON de la cuenta de servicio
//   (o la ruta a ese archivo). Solo el servidor accede a la base; las reglas
//   de firestore.rules bloquean todo acceso directo desde internet.
const fs = require('fs');
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

// Error de configuración: su mensaje es seguro de mostrar (nunca incluye el contenido de la clave).
function errorConfig(mensaje) {
  const e = new Error(mensaje);
  e.configuracion = true;
  return e;
}

function iniciar() {
  if (getApps().length) return;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'demo-clientes', storageBucket: process.env.FIREBASE_STORAGE_BUCKET });
    return;
  }
  const origen = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!origen) {
    throw errorConfig('Falta la variable de entorno FIREBASE_SERVICE_ACCOUNT (el JSON completo de la cuenta de servicio de Firebase)');
  }
  let json = origen;
  if (!origen.startsWith('{')) {
    // Se acepta también la ruta a un archivo (uso local). No se muestra el texto recibido: podría ser la clave.
    if (origen.length > 300 || !fs.existsSync(origen)) {
      throw errorConfig('FIREBASE_SERVICE_ACCOUNT debe ser el JSON completo (empieza con "{", sin comillas alrededor) o la ruta a un archivo existente');
    }
    json = fs.readFileSync(origen, 'utf8');
  }
  let cuenta;
  try {
    cuenta = JSON.parse(json);
  } catch {
    throw errorConfig('FIREBASE_SERVICE_ACCOUNT no es un JSON válido: pega el contenido completo del archivo descargado de Firebase');
  }
  try {
    initializeApp({ credential: cert(cuenta), storageBucket: process.env.FIREBASE_STORAGE_BUCKET });
  } catch {
    throw errorConfig('La clave de FIREBASE_SERVICE_ACCOUNT no es válida: descarga una nueva desde Firebase y pégala completa');
  }
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

// Bucket de Firebase Storage (documentos adjuntos). Es opcional: sin configurar, solo fallan los documentos.
function bucket() {
  if (!process.env.FIREBASE_STORAGE_BUCKET) {
    throw errorConfig('Los documentos no están configurados: falta la variable de entorno FIREBASE_STORAGE_BUCKET (nombre del bucket de Firebase Storage)');
  }
  return getStorage().bucket();
}

module.exports = { db, aObjeto, bucket, errorConfig };
