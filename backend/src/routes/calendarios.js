// Calendario impositivo mensual: se carga desde el PDF (o a mano), se revisa y se guarda;
// luego se aplica a los clientes según las obligaciones que tiene cada uno y su CUIT.
const express = require('express');
const router = express.Router();
const { db, aObjeto } = require('../db');
const { todosLosClientes } = require('../cache');
const { requiereAdmin } = require('../middleware/auth');
const { calendarioSchema, periodo: periodoSchema } = require('../validacion');
const { leerCalendarioPdf } = require('../calendario/leerPdf');
const { aplicarFilas } = require('../servicios/calendario');

const calendarios = () => db.collection('calendarios');

function periodoValido(req, res) {
  const r = periodoSchema.safeParse(req.params.periodo);
  if (!r.success) res.status(400).json({ error: 'Período inválido (AAAA-MM)' });
  return r.success;
}

router.get('/', async (_req, res) => {
  const snap = await calendarios().get();
  const lista = snap.docs.map((d) => ({ periodo: d.id, filas: d.data().filas.length, actualizadoEn: d.data().actualizadoEn.toDate() }));
  res.json(lista.sort((a, b) => b.periodo.localeCompare(a.periodo)));
});

// Obligaciones disponibles para asignar a los clientes: las del calendario más reciente.
router.get('/catalogo', async (_req, res) => {
  const snap = await calendarios().get();
  const ultimo = snap.docs.map((d) => d.id).sort().pop();
  if (!ultimo) return res.json([]);
  const filas = snap.docs.find((d) => d.id === ultimo).data().filas;
  res.json(filas.map((f) => ({ clave: f.clave, titulo: f.titulo, seccion: f.seccion })));
});

// Lee el PDF y devuelve la vista previa; NO guarda nada hasta que se confirme.
router.post('/importar', express.raw({ type: 'application/pdf', limit: '4mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.subarray(0, 4).toString() !== '%PDF') {
    return res.status(400).json({ error: 'Sube un archivo PDF' });
  }
  try {
    res.json(await leerCalendarioPdf(req.body));
  } catch (e) {
    res.status(422).json({ error: e.message || 'No se pudo leer el PDF' });
  }
});

router.get('/:periodo', async (req, res) => {
  if (!periodoValido(req, res)) return;
  const doc = await calendarios().doc(req.params.periodo).get();
  if (!doc.exists) return res.status(404).json({ error: 'Calendario no encontrado' });
  res.json(aObjeto(doc));
});

router.put('/:periodo', async (req, res) => {
  if (!periodoValido(req, res)) return;
  const r = calendarioSchema.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: 'Datos inválidos', detalles: r.error.flatten().fieldErrors });
  const claves = r.data.filas.map((f) => f.clave);
  if (new Set(claves).size !== claves.length) return res.status(400).json({ error: 'Hay filas con la misma clave' });
  const ref = calendarios().doc(req.params.periodo);
  const existente = await ref.get();
  await ref.set({
    filas: r.data.filas,
    creadoEn: existente.exists ? existente.data().creadoEn : new Date(),
    actualizadoEn: new Date(),
    actualizadoPor: req.usuario.id,
  });
  res.json({ ok: true, periodo: req.params.periodo, filas: r.data.filas.length });
});

router.delete('/:periodo', requiereAdmin, async (req, res) => {
  if (!periodoValido(req, res)) return;
  await calendarios().doc(req.params.periodo).delete();
  res.status(204).end();
});

// Crea (o actualiza, si la fecha cambió y sigue pendiente) los vencimientos de cada cliente
// activo para las obligaciones que tiene marcadas, según el último dígito de su CUIT.
router.post('/:periodo/aplicar', async (req, res) => {
  if (!req.usuario.todosLosClientes) return res.status(403).json({ error: 'Solo quien ve todos los clientes puede aplicar el calendario' });
  if (!periodoValido(req, res)) return;
  const doc = await calendarios().doc(req.params.periodo).get();
  if (!doc.exists) return res.status(404).json({ error: 'Calendario no encontrado' });
  const { filas } = doc.data();
  const periodo = req.params.periodo;

  res.json(await aplicarFilas(periodo, filas, await todosLosClientes()));
});

module.exports = router;
