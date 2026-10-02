// Honorarios del estudio: un honorario por cliente y período (abono mensual o trabajos puntuales),
// con cobros parciales o totales. `saldo` (= monto - pagado) se guarda en el documento para poder
// consultar "lo que se debe" con una sola consulta, sin leer el historial de pagos.
const router = require('express').Router();
const { db, aObjeto } = require('../db');
const { todosLosClientes } = require('../cache');
const { requiereAdmin } = require('../middleware/auth');
const { honorarioSchema, honorarioCambiosSchema, pagoSchema } = require('../validacion');
const { hoy, mapaClientes } = require('../util');

const honorarios = () => db.collection('honorarios');
const pagosDe = (id) => honorarios().doc(id).collection('pagos');
const redondear = (n) => Math.round(n * 100) / 100;
const mesActual = () => hoy().slice(0, 7);
const LIMITE = 2000;

function errorValidacion(res, error) {
  return res.status(400).json({ error: 'Datos inválidos', detalles: error.flatten().fieldErrors });
}

// Estado de cobro y si está atrasado (saldo pendiente de un mes que ya terminó... o el mes en curso ya empezado).
function salida(h, clientes) {
  const estado = h.saldo <= 0 ? 'PAGADO' : h.pagado > 0 ? 'PARCIAL' : 'PENDIENTE';
  return {
    ...h,
    clienteNombre: clientes.get(h.clienteId) ?? '(cliente eliminado)',
    estado,
    vencido: h.saldo > 0 && h.periodo < mesActual(),
  };
}
const totales = (lista) => ({
  monto: redondear(lista.reduce((t, h) => t + h.monto, 0)),
  pagado: redondear(lista.reduce((t, h) => t + h.pagado, 0)),
  saldo: redondear(lista.reduce((t, h) => t + h.saldo, 0)),
});

// ?periodo=AAAA-MM | ?clienteId=... | (nada = todo lo adeudado). Filtros extra en memoria: estado, q.
router.get('/', async (req, res) => {
  const { periodo, clienteId, estado, q } = req.query;
  let consulta = honorarios();
  if (clienteId) consulta = consulta.where('clienteId', '==', String(clienteId));
  else if (periodo) consulta = consulta.where('periodo', '==', String(periodo));
  else consulta = consulta.where('saldo', '>', 0).limit(LIMITE);

  const [snap, clientes] = await Promise.all([consulta.get(), mapaClientes()]);
  let lista = snap.docs.map(aObjeto).map((h) => salida(h, clientes));
  if (['PENDIENTE', 'PARCIAL', 'PAGADO'].includes(estado)) lista = lista.filter((h) => h.estado === estado);
  if (estado === 'DEUDA') lista = lista.filter((h) => h.saldo > 0);
  if (q) {
    const buscado = String(q).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    lista = lista.filter((h) => h.clienteNombre.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().includes(buscado));
  }
  lista.sort((a, b) => b.periodo.localeCompare(a.periodo) || a.clienteNombre.localeCompare(b.clienteNombre, 'es'));
  res.json({ totales: totales(lista), datos: lista });
});

// Deuda por cliente (todos los períodos), de mayor a menor.
router.get('/deudores', async (_req, res) => {
  const [snap, clientes] = await Promise.all([honorarios().where('saldo', '>', 0).limit(LIMITE).get(), mapaClientes()]);
  const porCliente = new Map();
  for (const h of snap.docs.map(aObjeto)) {
    const d = porCliente.get(h.clienteId) ?? { clienteId: h.clienteId, clienteNombre: clientes.get(h.clienteId) ?? '(cliente eliminado)', saldo: 0, cantidad: 0, masAntiguo: h.periodo };
    d.saldo = redondear(d.saldo + h.saldo);
    d.cantidad++;
    if (h.periodo < d.masAntiguo) d.masAntiguo = h.periodo;
    porCliente.set(h.clienteId, d);
  }
  const lista = [...porCliente.values()].sort((a, b) => b.saldo - a.saldo);
  res.json({ total: redondear(lista.reduce((t, d) => t + d.saldo, 0)), datos: lista });
});

router.post('/', async (req, res) => {
  const r = honorarioSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  if (!(await db.collection('clientes').doc(r.data.clienteId).get()).exists) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: { clienteId: ['El cliente no existe'] } });
  }
  const nuevo = { ...r.data, pagado: 0, saldo: r.data.monto, origen: 'manual', creadoPor: req.usuario.id, creadoEn: new Date() };
  const ref = await honorarios().add(nuevo);
  res.status(201).json(salida({ id: ref.id, ...nuevo }, await mapaClientes()));
});

// Crea el honorario del mes para cada cliente ACTIVO con abono mensual. No duplica si ya existe.
router.post('/generar', async (req, res) => {
  const periodo = String(req.body.periodo || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return res.status(400).json({ error: 'Período inválido (AAAA-MM)' });
  const activos = (await todosLosClientes()).filter((c) => c.estado === 'ACTIVO');
  const conAbono = activos.filter((c) => c.abonoMensual > 0);
  const refs = conAbono.map((c) => honorarios().doc(`${c.id}_abono_${periodo}`));
  const existentes = refs.length ? await db.getAll(...refs) : [];
  const nuevos = conAbono.filter((_, i) => !existentes[i].exists);
  for (let i = 0; i < nuevos.length; i += 400) {
    const lote = db.batch();
    for (const c of nuevos.slice(i, i + 400)) {
      lote.create(honorarios().doc(`${c.id}_abono_${periodo}`), {
        clienteId: c.id, periodo, concepto: 'Honorarios mensuales', monto: redondear(c.abonoMensual), pagado: 0, saldo: redondear(c.abonoMensual),
        origen: 'abono', creadoPor: req.usuario.id, creadoEn: new Date(),
      });
    }
    await lote.commit();
  }
  res.status(201).json({ creados: nuevos.length, yaExistian: conAbono.length - nuevos.length, sinAbono: activos.length - conAbono.length });
});

router.patch('/:id', async (req, res) => {
  const r = honorarioCambiosSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const ref = honorarios().doc(req.params.id);
  const resultado = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return { status: 404, error: 'Honorario no encontrado' };
    const h = doc.data();
    const monto = r.data.monto ?? h.monto;
    if (monto < h.pagado) return { status: 400, error: `El monto no puede ser menor a lo ya cobrado (${h.pagado})` };
    const cambios = { ...r.data, monto, saldo: redondear(monto - h.pagado) };
    tx.update(ref, cambios);
    return { ok: { id: doc.id, ...h, ...cambios } };
  });
  if (!resultado.ok) return res.status(resultado.status).json({ error: resultado.error });
  res.json(salida(resultado.ok, await mapaClientes()));
});

router.delete('/:id', requiereAdmin, async (req, res) => {
  const ref = honorarios().doc(req.params.id);
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Honorario no encontrado' });
  await db.recursiveDelete(ref); // incluye sus pagos
  res.status(204).end();
});

// ---- Cobros ----
router.get('/:id/pagos', async (req, res) => {
  const snap = await pagosDe(req.params.id).orderBy('fecha', 'desc').get();
  res.json(snap.docs.map(aObjeto));
});

router.post('/:id/pagos', async (req, res) => {
  const r = pagoSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const ref = honorarios().doc(req.params.id);
  const pagoRef = pagosDe(req.params.id).doc();
  const pago = { ...r.data, fecha: r.data.fecha ?? hoy(), registradoPor: req.usuario.id, creadoEn: new Date() };
  const resultado = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return { status: 404, error: 'Honorario no encontrado' };
    const h = doc.data();
    if (pago.monto > h.saldo + 0.001) return { status: 400, error: `El cobro (${pago.monto}) supera el saldo pendiente (${h.saldo})` };
    const pagado = redondear(h.pagado + pago.monto);
    const cambios = { pagado, saldo: redondear(h.monto - pagado) };
    tx.set(pagoRef, pago);
    tx.update(ref, cambios);
    return { ok: { id: doc.id, ...h, ...cambios } };
  });
  if (!resultado.ok) return res.status(resultado.status).json({ error: resultado.error });
  res.status(201).json({ pago: { id: pagoRef.id, ...pago }, honorario: salida(resultado.ok, await mapaClientes()) });
});

// Anular un cobro (por error de carga): solo administradores. Devuelve el saldo.
router.delete('/:id/pagos/:pid', requiereAdmin, async (req, res) => {
  const ref = honorarios().doc(req.params.id);
  const pagoRef = pagosDe(req.params.id).doc(req.params.pid);
  const resultado = await db.runTransaction(async (tx) => {
    const [doc, pagoDoc] = await Promise.all([tx.get(ref), tx.get(pagoRef)]);
    if (!doc.exists || !pagoDoc.exists) return { status: 404, error: 'Cobro no encontrado' };
    const h = doc.data();
    const pagado = Math.max(0, redondear(h.pagado - pagoDoc.data().monto));
    tx.delete(pagoRef);
    tx.update(ref, { pagado, saldo: redondear(h.monto - pagado) });
    return { ok: true };
  });
  if (!resultado.ok) return res.status(resultado.status).json({ error: resultado.error });
  res.status(204).end();
});

module.exports = router;
