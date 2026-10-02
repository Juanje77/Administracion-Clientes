// Documentos adjuntos de cada cliente (contratos, presupuestos, facturas…) en Firebase Storage.
// Los archivos pasan siempre por el servidor: se verifican al subir y se descargan solo con sesión
// iniciada (no hay enlaces públicos). Límite de 4 MB por archivo (tope de las funciones de Vercel).
const express = require('express');
const router = express.Router();
const path = require('path');
const { db, aObjeto, bucket } = require('../db');
const { CATEGORIAS_DOC } = require('../validacion');

const documentos = () => db.collection('documentos');
const MAX_BYTES = 4 * 1024 * 1024;

// Tipos permitidos. El tipo se decide por la extensión y se confirma mirando el contenido real
// (así no se puede subir un ejecutable o una página web renombrada a .pdf).
const comienza = (b, ...bytes) => bytes.every((x, i) => b[i] === x);
const TIPOS = {
  '.pdf': { mime: 'application/pdf', ver: true, ok: (b) => b.subarray(0, 5).toString() === '%PDF-' },
  '.png': { mime: 'image/png', ver: true, ok: (b) => comienza(b, 0x89, 0x50, 0x4e, 0x47) },
  '.jpg': { mime: 'image/jpeg', ver: true, ok: (b) => comienza(b, 0xff, 0xd8, 0xff) },
  '.jpeg': { mime: 'image/jpeg', ver: true, ok: (b) => comienza(b, 0xff, 0xd8, 0xff) },
  '.webp': { mime: 'image/webp', ver: true, ok: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
  '.heic': { mime: 'image/heic', ver: false, ok: (b) => b.subarray(4, 8).toString() === 'ftyp' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ver: false, ok: (b) => comienza(b, 0x50, 0x4b) },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ver: false, ok: (b) => comienza(b, 0x50, 0x4b) },
  '.doc': { mime: 'application/msword', ver: false, ok: (b) => comienza(b, 0xd0, 0xcf, 0x11, 0xe0) },
  '.xls': { mime: 'application/vnd.ms-excel', ver: false, ok: (b) => comienza(b, 0xd0, 0xcf, 0x11, 0xe0) },
  '.csv': { mime: 'text/csv', ver: false, ok: (b) => !b.subarray(0, 2048).includes(0) },
  '.txt': { mime: 'text/plain', ver: false, ok: (b) => !b.subarray(0, 2048).includes(0) },
};

// Nombre mostrado: sin rutas ni caracteres de control, y de largo razonable.
function limpiarNombre(nombre) {
  const base = path.basename(String(nombre || '').replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim();
  return base.slice(-120);
}

const salida = (d) => d;

router.get('/', async (req, res) => {
  if (!req.query.clienteId) return res.status(400).json({ error: 'Falta el cliente' });
  const snap = await documentos().where('clienteId', '==', String(req.query.clienteId)).get();
  res.json(snap.docs.map(aObjeto).map(salida).sort((a, b) => b.creadoEn - a.creadoEn));
});

// Se sube el archivo tal cual en el cuerpo; el nombre, la categoría y el cliente van en la URL.
router.post('/', express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res) => {
  const clienteId = String(req.query.clienteId || '');
  const nombre = limpiarNombre(req.query.nombre);
  const categoria = CATEGORIAS_DOC.includes(req.query.categoria) ? req.query.categoria : 'OTRO';
  if (!clienteId) return res.status(400).json({ error: 'Falta el cliente' });
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre del archivo' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'El archivo está vacío' });
  const ext = path.extname(nombre).toLowerCase();
  const tipo = TIPOS[ext];
  if (!tipo) return res.status(400).json({ error: `Tipo de archivo no permitido. Se aceptan: ${Object.keys(TIPOS).join(', ')}` });
  if (!tipo.ok(req.body)) return res.status(400).json({ error: 'El contenido del archivo no coincide con su tipo' });
  if (!(await db.collection('clientes').doc(clienteId).get()).exists) return res.status(404).json({ error: 'Cliente no encontrado' });

  const archivos = bucket();
  const ref = documentos().doc();
  const ruta = `clientes/${clienteId}/${ref.id}${ext}`; // el nombre original no se usa en la ruta
  await archivos.file(ruta).save(req.body, { contentType: tipo.mime, resumable: false });

  const autor = await db.collection('usuarios').doc(req.usuario.id).get();
  const doc = { clienteId, nombre, categoria, tipo: tipo.mime, tamano: req.body.length, ruta, subidoPor: req.usuario.id, subidoPorNombre: autor.data().nombre, creadoEn: new Date() };
  await ref.set(doc);
  res.status(201).json(salida({ id: ref.id, ...doc }));
});

router.get('/:id/descargar', async (req, res) => {
  const doc = await documentos().doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Documento no encontrado' });
  const d = doc.data();
  const ext = path.extname(d.nombre).toLowerCase();
  const inline = req.query.ver === '1' && TIPOS[ext]?.ver;
  const archivo = bucket().file(d.ruta);
  res.setHeader('Content-Type', d.tipo);
  res.setHeader('Content-Length', d.tamano);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(d.nombre)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  archivo.createReadStream()
    .on('error', () => { if (!res.headersSent) res.status(404).json({ error: 'El archivo no está disponible' }); else res.end(); })
    .pipe(res);
});

router.delete('/:id', async (req, res) => {
  const ref = documentos().doc(req.params.id);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Documento no encontrado' });
  if (doc.data().subidoPor !== req.usuario.id && req.usuario.rol !== 'ADMIN') {
    return res.status(403).json({ error: 'Solo quien lo subió o un administrador puede borrarlo' });
  }
  await bucket().file(doc.data().ruta).delete({ ignoreNotFound: true });
  await ref.delete();
  res.status(204).end();
});

// Al borrar un cliente definitivamente se borran también sus archivos.
async function borrarDocumentosDeCliente(clienteId) {
  const snap = await documentos().where('clienteId', '==', clienteId).get();
  if (snap.empty) return;
  let archivos = null;
  try { archivos = bucket(); } catch { /* Storage sin configurar: solo se borran los registros */ }
  await Promise.all(snap.docs.map(async (d) => {
    if (archivos) await archivos.file(d.data().ruta).delete({ ignoreNotFound: true });
    await d.ref.delete();
  }));
}

module.exports = router;
module.exports.borrarDocumentosDeCliente = borrarDocumentosDeCliente;
