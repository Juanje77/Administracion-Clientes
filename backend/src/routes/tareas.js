const router = require('express').Router();
const { db, aObjeto } = require('../db');
const { todosLosClientes } = require('../cache');
const { tareaSchema, tareaCambiosSchema } = require('../validacion');
const { hoy, sumarDias, situacion, mapaClientes, mapaUsuarios, porFecha, alertaTarea, diasAgenda, LIMITE_AGENDA } = require('../util');

const tareas = () => db.collection('tareas');

function errorValidacion(res, error) {
  return res.status(400).json({ error: 'Datos inválidos', detalles: error.flatten().fieldErrors });
}

const salida = (t, clientes, usuarios) => ({
  ...t,
  clienteNombre: clientes.get(t.clienteId) ?? '(cliente eliminado)',
  asignadoNombre: t.asignadoA ? usuarios.get(t.asignadoA) ?? null : null,
  situacion: situacion(t.vence, t.hecha),
});

// Con clienteId se devuelven todas las tareas de ese cliente (hechas y pendientes).
// Sin clienteId (Agenda) solo las pendientes: lo vencido más lo que vence en los próximos `dias`.
router.get('/', async (req, res) => {
  const { clienteId, asignado } = req.query;
  const limite = sumarDias(hoy(), diasAgenda(req.query.dias));
  let consulta = tareas();
  if (clienteId) consulta = consulta.where('clienteId', '==', String(clienteId));
  else if (asignado) {
    const quien = asignado === 'yo' ? req.usuario.id : String(asignado);
    consulta = consulta.where('alertaDe', '>=', `${quien}|`).where('alertaDe', '<=', `${quien}|${limite}`).limit(LIMITE_AGENDA);
  } else consulta = consulta.where('alerta', '<=', limite).orderBy('alerta').limit(LIMITE_AGENDA);

  const [snap, clientes, usuarios] = await Promise.all([consulta.get(), mapaClientes(), mapaUsuarios()]);
  let lista = snap.docs.map(aObjeto);
  if (clienteId && asignado) lista = lista.filter((t) => t.asignadoA === (asignado === 'yo' ? req.usuario.id : String(asignado)));
  lista = lista.map((t) => salida(t, clientes, usuarios));
  // Pendientes primero (por fecha), luego las hechas (las más recientes arriba).
  lista.sort((a, b) => a.hecha - b.hecha || (a.hecha ? b.vence.localeCompare(a.vence) : porFecha(a, b)));
  res.json(lista);
});

router.post('/', async (req, res) => {
  const r = tareaSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  if (!(await db.collection('clientes').doc(r.data.clienteId).get()).exists) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: { clienteId: ['El cliente no existe'] } });
  }
  if (r.data.asignadoA && !(await db.collection('usuarios').doc(r.data.asignadoA).get()).exists) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: { asignadoA: ['El usuario no existe'] } });
  }
  const nueva = {
    ...r.data,
    asignadoA: r.data.asignadoA ?? req.usuario.id, // por defecto, quien la crea
    hecha: false,
    hechaEn: null,
    creadoPor: req.usuario.id,
    creadoEn: new Date(),
  };
  Object.assign(nueva, alertaTarea(nueva));
  const ref = await tareas().add(nueva);
  const [clientes, usuarios] = await Promise.all([mapaClientes(), mapaUsuarios()]);
  res.status(201).json(salida({ id: ref.id, ...nueva }, clientes, usuarios));
});

router.patch('/:id', async (req, res) => {
  const r = tareaCambiosSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const ref = tareas().doc(req.params.id);
  const actual = await ref.get();
  if (!actual.exists) return res.status(404).json({ error: 'Tarea no encontrada' });
  const { hecha, ...resto } = r.data;
  const cambios = { ...resto };
  if (hecha !== undefined) {
    cambios.hecha = hecha;
    cambios.hechaEn = hecha ? new Date() : null;
  }
  Object.assign(cambios, alertaTarea({ ...actual.data(), ...cambios }));
  await ref.update(cambios);
  const [doc, clientes, usuarios] = await Promise.all([ref.get(), mapaClientes(), mapaUsuarios()]);
  res.json(salida(aObjeto(doc), clientes, usuarios));
});

router.delete('/:id', async (req, res) => {
  const ref = tareas().doc(req.params.id);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (doc.data().creadoPor !== req.usuario.id && req.usuario.rol !== 'ADMIN') {
    return res.status(403).json({ error: 'Solo quien la creó o un administrador puede borrarla' });
  }
  await ref.delete();
  res.status(204).end();
});

module.exports = router;
