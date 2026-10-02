const router = require('express').Router();
const { db, aObjeto } = require('../db');
const { vencimientoSchema } = require('../validacion');
const { hoy, sumarDias, situacion, mapaClientes, porFecha, alertaVencimiento, diasAgenda, LIMITE_AGENDA } = require('../util');

const vencimientos = () => db.collection('vencimientos');

function errorValidacion(res, error) {
  return res.status(400).json({ error: 'Datos inválidos', detalles: error.flatten().fieldErrors });
}

const salida = (v, clientes) => ({
  ...v,
  clienteNombre: clientes.get(v.clienteId) ?? '(cliente eliminado)',
  situacion: situacion(v.vence, v.estado === 'PRESENTADO'),
});

const slug = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Con clienteId se devuelven todos los de ese cliente. Sin clienteId (Agenda) solo los pendientes:
// lo vencido más lo que vence en los próximos `dias` (7 por defecto).
router.get('/', async (req, res) => {
  const { clienteId } = req.query;
  const consulta = clienteId
    ? vencimientos().where('clienteId', '==', String(clienteId))
    : vencimientos().where('alerta', '<=', sumarDias(hoy(), diasAgenda(req.query.dias))).orderBy('alerta').limit(LIMITE_AGENDA);
  const [snap, clientes] = await Promise.all([consulta.get(), mapaClientes()]);
  const lista = snap.docs.map(aObjeto).map((v) => salida(v, clientes));
  lista.sort((a, b) => (a.estado === 'PRESENTADO') - (b.estado === 'PRESENTADO') || porFecha(a, b));
  res.json(lista);
});

router.post('/', async (req, res) => {
  const r = vencimientoSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  if (!(await db.collection('clientes').doc(r.data.clienteId).get()).exists) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: { clienteId: ['El cliente no existe'] } });
  }
  const id = `${r.data.clienteId}_${slug(r.data.impuesto)}_${r.data.periodo}`;
  const ref = vencimientos().doc(id);
  const nuevo = { ...r.data, estado: 'PENDIENTE', presentadoEn: null, creadoEn: new Date() };
  Object.assign(nuevo, alertaVencimiento(nuevo));
  try {
    await ref.create(nuevo); // falla si ya existe ese impuesto/período para el cliente
  } catch (e) {
    if (e.code === 6 || /already exists/i.test(e.message)) {
      return res.status(409).json({ error: 'Ese vencimiento ya está cargado para el cliente' });
    }
    throw e;
  }
  res.status(201).json(salida({ id, ...nuevo }, await mapaClientes()));
});

router.patch('/:id', async (req, res) => {
  const ref = vencimientos().doc(req.params.id);
  const actual = await ref.get();
  if (!actual.exists) return res.status(404).json({ error: 'Vencimiento no encontrado' });
  const estado = req.body.estado;
  if (!['PENDIENTE', 'PRESENTADO'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  await ref.update({ estado, presentadoEn: estado === 'PRESENTADO' ? new Date() : null, ...alertaVencimiento({ ...actual.data(), estado }) });
  res.json(salida(aObjeto(await ref.get()), await mapaClientes()));
});

router.delete('/:id', async (req, res) => {
  const ref = vencimientos().doc(req.params.id);
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Vencimiento no encontrado' });
  await ref.delete();
  res.status(204).end();
});

module.exports = router;
