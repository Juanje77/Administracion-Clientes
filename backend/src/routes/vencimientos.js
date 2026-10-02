const router = require('express').Router();
const { db, aObjeto } = require('../db');
const { todosLosClientes } = require('../cache');
const { vencimientoSchema, generarSchema } = require('../validacion');
const { situacion, mapaClientes, porFecha } = require('../util');

const vencimientos = () => db.collection('vencimientos');

function errorValidacion(res, error) {
  return res.status(400).json({ error: 'Datos inválidos', detalles: error.flatten().fieldErrors });
}

const salida = (v, clientes) => ({
  ...v,
  clienteNombre: clientes.get(v.clienteId) ?? '(cliente eliminado)',
  situacion: situacion(v.vence, v.estado === 'PRESENTADO'),
});

// Grupo de terminación de CUIT ("0-1", "2-3", ...) según el último dígito.
function grupoCuit(cuit) {
  const digitos = String(cuit || '').replace(/\D/g, '');
  if (digitos.length !== 11) return null;
  const d = Number(digitos[10]);
  return `${d - (d % 2)}-${d - (d % 2) + 1}`;
}
const slug = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Sin clienteId solo se listan los pendientes; con clienteId, todos los de ese cliente.
router.get('/', async (req, res) => {
  const { clienteId } = req.query;
  const consulta = clienteId
    ? vencimientos().where('clienteId', '==', String(clienteId))
    : vencimientos().where('estado', '==', 'PENDIENTE');
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

// Genera el mismo vencimiento para muchos clientes, con la fecha según la terminación del CUIT.
router.post('/generar', async (req, res) => {
  const r = generarSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const { impuesto, periodo, fechas, etiqueta, incluirInactivos } = r.data;

  let candidatos = (await todosLosClientes()).filter((c) => (incluirInactivos ? c.estado !== 'POTENCIAL' : c.estado === 'ACTIVO'));
  if (etiqueta) candidatos = candidatos.filter((c) => (c.etiquetas || []).includes(etiqueta.toLowerCase()));

  const sinCuit = [];
  const nuevos = [];
  for (const c of candidatos) {
    const vence = fechas[grupoCuit(c.cuit)];
    if (!grupoCuit(c.cuit)) sinCuit.push(c.razonSocial);
    else if (vence) nuevos.push({ cliente: c, vence, id: `${c.id}_${slug(impuesto)}_${periodo}` });
  }

  const existentes = nuevos.length ? await db.getAll(...nuevos.map((n) => vencimientos().doc(n.id))) : [];
  const yaExisten = new Set(existentes.filter((d) => d.exists).map((d) => d.id));
  const aCrear = nuevos.filter((n) => !yaExisten.has(n.id));

  for (let i = 0; i < aCrear.length; i += 400) {
    const lote = db.batch();
    for (const n of aCrear.slice(i, i + 400)) {
      lote.create(vencimientos().doc(n.id), {
        clienteId: n.cliente.id, impuesto, periodo, vence: n.vence, notas: null,
        estado: 'PENDIENTE', presentadoEn: null, creadoEn: new Date(),
      });
    }
    await lote.commit();
  }
  res.status(201).json({ creados: aCrear.length, yaExistian: yaExisten.size, sinCuit });
});

router.patch('/:id', async (req, res) => {
  const ref = vencimientos().doc(req.params.id);
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Vencimiento no encontrado' });
  const estado = req.body.estado;
  if (!['PENDIENTE', 'PRESENTADO'].includes(estado)) return res.status(400).json({ error: 'Estado inválido' });
  await ref.update({ estado, presentadoEn: estado === 'PRESENTADO' ? new Date() : null });
  res.json(salida(aObjeto(await ref.get()), await mapaClientes()));
});

router.delete('/:id', async (req, res) => {
  const ref = vencimientos().doc(req.params.id);
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Vencimiento no encontrado' });
  await ref.delete();
  res.status(204).end();
});

module.exports = router;
