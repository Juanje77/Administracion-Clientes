// Honorarios del estudio: un honorario por cliente y período (abono mensual o trabajos puntuales),
// con cobros parciales o totales. `saldo` (= monto - pagado) se guarda en el documento para poder
// consultar "lo que se debe" con una sola consulta, sin leer el historial de pagos.
const router = require('express').Router();
const { db, aObjeto } = require('../db');
const { todosLosClientes } = require('../cache');
const { requiereAdmin } = require('../middleware/auth');
const { idsVisibles, puedeVerCliente, exigirCliente } = require('../servicios/acceso');
const { honorarioSchema, honorarioCambiosSchema, pagoSchema } = require('../validacion');
const { hoy, mapaClientes } = require('../util');
const { honorarios, consultar, deudores, conEstado, redondear } = require('../servicios/honorarios');
const { enviarRecibo } = require('../servicios/recibos');
const { sumarFacturado, sumarCobrado, borrarHonorarios } = require('../servicios/resumenes');

// Los cobros son una colección propia (no una subcolección) para poder sumarlos por fecha
// en todo el estudio sin leerlos uno por uno (dashboard).
const pagos = () => db.collection('pagos');
const salida = (h, clientes) => conEstado(h, clientes);

function errorValidacion(res, error) {
  return res.status(400).json({ error: 'Datos inválidos', detalles: error.flatten().fieldErrors });
}

// ?periodo=AAAA-MM | ?clienteId=... | (nada = todo lo adeudado). Filtros extra: estado, q.
router.get('/', async (req, res) => {
  if (req.query.clienteId && !(await exigirCliente(req, res, String(req.query.clienteId)))) return;
  res.json(await consultar(req.query, await idsVisibles(req.usuario)));
});
router.get('/deudores', async (req, res) => res.json(await deudores(await idsVisibles(req.usuario))));

// Un honorario de un cliente que no puede ver es, para esta persona, un honorario inexistente.
router.param('id', async (req, res, next, id) => {
  if (req.usuario.todosLosClientes) return next();
  const doc = await honorarios().doc(id).get();
  if (doc.exists && !(await puedeVerCliente(req.usuario, doc.data().clienteId))) return res.status(404).json({ error: 'Honorario no encontrado' });
  next();
});

router.post('/', async (req, res) => {
  const r = honorarioSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  if (!(await db.collection('clientes').doc(r.data.clienteId).get()).exists || !(await puedeVerCliente(req.usuario, r.data.clienteId))) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: { clienteId: ['El cliente no existe'] } });
  }
  const nuevo = { ...r.data, pagado: 0, saldo: r.data.monto, origen: 'manual', creadoPor: req.usuario.id, creadoEn: new Date() };
  const ref = honorarios().doc();
  const lote = db.batch();
  lote.create(ref, nuevo);
  sumarFacturado(lote, nuevo.periodo, nuevo.monto);
  await lote.commit();
  res.status(201).json(salida({ id: ref.id, ...nuevo }, await mapaClientes()));
});

// Crea el honorario del mes para cada cliente ACTIVO con abono mensual. No duplica si ya existe.
router.post('/generar', async (req, res) => {
  if (!req.usuario.todosLosClientes) return res.status(403).json({ error: 'Solo quien ve todos los clientes puede generar los honorarios del mes' });
  const periodo = String(req.body.periodo || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return res.status(400).json({ error: 'Período inválido (AAAA-MM)' });
  const activos = (await todosLosClientes()).filter((c) => c.estado === 'ACTIVO');
  const conAbono = activos.filter((c) => c.abonoMensual > 0);
  const refs = conAbono.map((c) => honorarios().doc(`${c.id}_abono_${periodo}`));
  const existentes = refs.length ? await db.getAll(...refs) : [];
  const nuevos = conAbono.filter((_, i) => !existentes[i].exists);
  for (let i = 0; i < nuevos.length; i += 400) {
    const lote = db.batch();
    sumarFacturado(lote, periodo, redondear(nuevos.slice(i, i + 400).reduce((t, c) => t + redondear(c.abonoMensual), 0)));
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
    sumarFacturado(tx, h.periodo, monto - h.monto);
    return { ok: { id: doc.id, ...h, ...cambios } };
  });
  if (!resultado.ok) return res.status(resultado.status).json({ error: resultado.error });
  res.json(salida(resultado.ok, await mapaClientes()));
});

router.delete('/:id', requiereAdmin, async (req, res) => {
  const doc = await honorarios().doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Honorario no encontrado' });
  await borrarHonorarios([doc]); // también descuenta sus montos de los totales del Inicio
  res.status(204).end();
});

// ---- Cobros ----
router.get('/:id/pagos', async (req, res) => {
  const snap = await pagos().where('honorarioId', '==', req.params.id).get();
  res.json(snap.docs.map(aObjeto).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creadoEn - a.creadoEn));
});

router.post('/:id/pagos', async (req, res) => {
  const r = pagoSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const ref = honorarios().doc(req.params.id);
  const pagoRef = pagos().doc();
  const contadorRecibos = db.collection('contadores').doc('recibos');
  const { enviarRecibo: quiereRecibo, ...datosPago } = r.data;
  const pago = { ...datosPago, honorarioId: req.params.id, fecha: r.data.fecha ?? hoy(), registradoPor: req.usuario.id, creadoEn: new Date() };
  const resultado = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return { status: 404, error: 'Honorario no encontrado' };
    const h = doc.data();
    const contador = await tx.get(contadorRecibos);
    if (pago.monto > h.saldo + 0.001) return { status: 400, error: `El cobro (${pago.monto}) supera el saldo pendiente (${h.saldo})` };
    pago.clienteId = h.clienteId;
    pago.numero = (contador.exists ? contador.data().ultimo : 0) + 1; // numeración correlativa de recibos
    tx.set(contadorRecibos, { ultimo: pago.numero });
    const pagado = redondear(h.pagado + pago.monto);
    const cambios = { pagado, saldo: redondear(h.monto - pagado) };
    tx.set(pagoRef, pago);
    tx.update(ref, cambios);
    sumarCobrado(tx, pago.fecha, pago.monto);
    return { ok: { id: doc.id, ...h, ...cambios } };
  });
  if (!resultado.ok) return res.status(resultado.status).json({ error: resultado.error });
  // El recibo no puede hacer fallar el cobro: ya quedó registrado.
  const cliente = (await todosLosClientes()).find((c) => c.id === resultado.ok.clienteId);
  const recibo = quiereRecibo === false ? null : await enviarRecibo({ pago: { id: pagoRef.id, ...pago }, honorario: resultado.ok, cliente });
  res.status(201).json({ pago: { id: pagoRef.id, ...pago }, honorario: salida(resultado.ok, await mapaClientes()), recibo });
});

// Reenviar el recibo de un cobro (por ejemplo, si el cliente cambió de email o no le llegó).
router.post('/:id/pagos/:pid/recibo', async (req, res) => {
  const [hDoc, pDoc] = await Promise.all([honorarios().doc(req.params.id).get(), pagos().doc(req.params.pid).get()]);
  if (!hDoc.exists || !pDoc.exists || pDoc.data().honorarioId !== req.params.id) return res.status(404).json({ error: 'Cobro no encontrado' });
  const cliente = (await todosLosClientes()).find((c) => c.id === hDoc.data().clienteId);
  res.json({ recibo: await enviarRecibo({ pago: { id: pDoc.id, ...pDoc.data() }, honorario: { id: hDoc.id, ...hDoc.data() }, cliente, reenviar: true }) });
});

// Anular un cobro (por error de carga): solo administradores. Devuelve el saldo.
router.delete('/:id/pagos/:pid', requiereAdmin, async (req, res) => {
  const ref = honorarios().doc(req.params.id);
  const pagoRef = pagos().doc(req.params.pid);
  const resultado = await db.runTransaction(async (tx) => {
    const [doc, pagoDoc] = await Promise.all([tx.get(ref), tx.get(pagoRef)]);
    if (!doc.exists || !pagoDoc.exists || pagoDoc.data().honorarioId !== req.params.id) return { status: 404, error: 'Cobro no encontrado' };
    const h = doc.data();
    const pagado = Math.max(0, redondear(h.pagado - pagoDoc.data().monto));
    tx.delete(pagoRef);
    tx.update(ref, { pagado, saldo: redondear(h.monto - pagado) });
    sumarCobrado(tx, pagoDoc.data().fecha, -pagoDoc.data().monto);
    return { ok: true };
  });
  if (!resultado.ok) return res.status(resultado.status).json({ error: resultado.error });
  res.status(204).end();
});

module.exports = router;
