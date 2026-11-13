// Sueldos del equipo (solo administradores): cuánto le corresponde a cada persona según lo cobrado de sus clientes,
// registro de los pagos de sueldo y ganancia del estudio.
const router = require('express').Router();
const { db } = require('../db');
const { requiereAdmin } = require('../middleware/auth');
const { periodo: periodoSchema, pagoSueldoSchema } = require('../validacion');
const { hoy } = require('../util');
const { calcular, sueldoPagos } = require('../servicios/sueldos');

router.use(requiereAdmin);

router.get('/', async (req, res) => {
  const p = periodoSchema.safeParse(req.query.periodo ?? hoy().slice(0, 7));
  if (!p.success) return res.status(400).json({ error: 'Período inválido (AAAA-MM)' });
  res.json(await calcular(p.data));
});

router.post('/pagos', async (req, res) => {
  const r = pagoSueldoSchema.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: 'Datos inválidos', detalles: r.error.flatten().fieldErrors });
  const persona = await db.collection('usuarios').doc(r.data.usuarioId).get();
  if (!persona.exists || persona.data().rol === 'ADMIN') return res.status(400).json({ error: 'Datos inválidos', detalles: { usuarioId: ['La persona no existe o es administradora'] } });
  const pago = { ...r.data, fecha: r.data.fecha ?? hoy(), usuarioNombre: persona.data().nombre, registradoPor: req.usuario.id, creadoEn: new Date() };
  const ref = await sueldoPagos().add(pago);
  res.status(201).json({ pago: { id: ref.id, ...pago }, resumen: await calcular(r.data.periodo) });
});

router.delete('/pagos/:id', async (req, res) => {
  const ref = sueldoPagos().doc(req.params.id);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Pago no encontrado' });
  await ref.delete();
  res.status(204).end();
});

module.exports = router;
