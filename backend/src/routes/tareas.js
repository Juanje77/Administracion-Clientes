const router = require('express').Router();
const { db, aObjeto } = require('../db');
const { todosLosClientes } = require('../cache');
const { tareaSchema, tareaCambiosSchema } = require('../validacion');
const { situacion, mapaClientes, mapaUsuarios, porFecha } = require('../util');

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

// Sin clienteId solo se listan las pendientes (evita leer todo el historial).
// Con clienteId se devuelven todas las de ese cliente.
router.get('/', async (req, res) => {
  const { clienteId, asignado } = req.query;
  let consulta = tareas();
  consulta = clienteId ? consulta.where('clienteId', '==', String(clienteId)) : consulta.where('hecha', '==', false);
  const [snap, clientes, usuarios] = await Promise.all([consulta.get(), mapaClientes(), mapaUsuarios()]);
  let lista = snap.docs.map(aObjeto);
  if (asignado) lista = lista.filter((t) => t.asignadoA === (asignado === 'yo' ? req.usuario.id : String(asignado)));
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
  const ref = await tareas().add(nueva);
  const [clientes, usuarios] = await Promise.all([mapaClientes(), mapaUsuarios()]);
  res.status(201).json(salida({ id: ref.id, ...nueva }, clientes, usuarios));
});

router.patch('/:id', async (req, res) => {
  const r = tareaCambiosSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const ref = tareas().doc(req.params.id);
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Tarea no encontrada' });
  const { hecha, ...resto } = r.data;
  const cambios = { ...resto };
  if (hecha !== undefined) {
    cambios.hecha = hecha;
    cambios.hechaEn = hecha ? new Date() : null;
  }
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
