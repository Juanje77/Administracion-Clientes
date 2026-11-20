// Claves de ARCA y de Rentas de cada cliente. Se guardan CIFRADAS (AES-256-GCM) en `claves/{clienteId}`, nunca en texto
// plano, y no viajan en las listas de clientes, exportaciones ni respaldos legibles. La llave sale de la variable de entorno
// CLAVES_SECRET: sin ella la sección no funciona, y si se pierde las claves guardadas no se pueden recuperar.
const crypto = require('crypto');
const { db, errorConfig } = require('../db');

const claves = () => db.collection('claves');
const CAMPOS = ['arca', 'rentas'];

function llave() {
  const secreto = process.env.CLAVES_SECRET;
  if (!secreto || secreto.length < 16) {
    throw errorConfig('Falta configurar CLAVES_SECRET (mínimo 16 caracteres): es la llave con la que se cifran las claves de los clientes (ver README, sección Claves)');
  }
  return crypto.scryptSync(secreto, 'estudio-claves-v1', 32);
}

function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', llave(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${datos.toString('base64')}`;
}

function descifrar(valor) {
  const [v, iv, tag, datos] = String(valor).split(':');
  if (v !== 'v1') throw new Error('Formato de clave desconocido');
  const d = crypto.createDecipheriv('aes-256-gcm', llave(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(datos, 'base64')), d.final()]).toString('utf8');
}

// Qué clientes tienen cargada cada clave (sin leer ni descifrar nada)
async function resumen() {
  const snap = await claves().get();
  return new Map(snap.docs.map((d) => [d.id, { arca: Boolean(d.data().arca), rentas: Boolean(d.data().rentas) }]));
}

async function leer(clienteId, campo) {
  const d = await claves().doc(clienteId).get();
  const v = d.exists ? d.data()[campo] : null;
  return v ? descifrar(v) : null;
}

// cambios: { arca?, rentas? } — undefined = no tocar, '' = borrar
async function guardar(clienteId, cambios, usuarioId) {
  const datos = { actualizadoEn: new Date(), actualizadoPor: usuarioId };
  for (const c of CAMPOS) {
    if (cambios[c] === undefined) continue;
    datos[c] = cambios[c] === '' ? null : cifrar(cambios[c]);
  }
  await claves().doc(clienteId).set(datos, { merge: true });
}

const borrarDeCliente = (clienteId) => claves().doc(clienteId).delete();

module.exports = { CAMPOS, resumen, leer, guardar, borrarDeCliente, cifrar, descifrar };
