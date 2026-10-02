const router = require('express').Router();
const { db, aObjeto } = require('../db');
const { todosLosClientes } = require('../cache');
const { tareaSchema, tareaCambiosSchema } = require('../validacion');
const { avisarAsignacion } = require('../servicios/asignaciones');
const { hoy, sumarDias, situacion, mapaClientes, mapaUsuarios, porFecha, alertaTarea, diasAgenda, LIMITE_AGENDA } = require('../util');

const tareas = () => db.collection('tareas');

function errorValidacion(res, error) {
  return res.status(400).json({ error: 'Datos inválidos', detalles: error.flatten().fieldErrors });
}

const salida = (t, clientes, usuarios) => ({
  ...t,
  // sin clienteId = tarea interna del estudio
  clienteNombre: t.clienteId ? clientes.get(t.clienteId) ?? '(cliente eliminado)' : null,
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

// Valida que el cliente (si lo hay) y el responsable existan; el responsable debe estar activo.
async function validarReferencias({ clienteId, asignadoA }) {
  const detalles = {};
  if (clienteId && !(await db.collection('clientes').doc(clienteId).get()).exists) detalles.clienteId = ['El cliente no existe'];
  let asignado = null;
  if (asignadoA) {
    const doc = await db.collection('usuarios').doc(asignadoA).get();
    if (!doc.exists || doc.data().activo === false) detalles.asignadoA = ['La persona elegida no existe o está desactivada'];
    else asignado = { id: doc.id, ...doc.data() };
  }
  return { detalles: Object.keys(detalles).length ? detalles : null, asignado };
}

const usuarioActual = async (id) => ({ id, ...(await db.collection('usuarios').doc(id).get()).data() });
const nombreCliente = async (clienteId) => (clienteId ? (await mapaClientes()).get(clienteId) ?? null : null);

router.post('/', async (req, res) => {
  const r = tareaSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const asignadoA = r.data.asignadoA ?? req.usuario.id; // por defecto, quien la crea
  const { detalles, asignado } = await validarReferencias({ clienteId: r.data.clienteId, asignadoA });
  if (detalles) return res.status(400).json({ error: 'Datos inválidos', detalles });

  const nueva = {
    ...r.data,
    clienteId: r.data.clienteId ?? null,
    descripcion: r.data.descripcion ?? null,
    asignadoA,
    hecha: false,
    hechaEn: null,
    creadoPor: req.usuario.id,
    creadoEn: new Date(),
  };
  Object.assign(nueva, alertaTarea(nueva));
  const ref = await tareas().add(nueva);
  const aviso = await avisarAsignacion({ tarea: { id: ref.id, ...nueva }, asignado, actor: await usuarioActual(req.usuario.id), clienteNombre: await nombreCliente(nueva.clienteId) });
  const [clientes, usuarios] = await Promise.all([mapaClientes(), mapaUsuarios()]);
  res.status(201).json({ ...salida({ id: ref.id, ...nueva }, clientes, usuarios), aviso });
});

// Edita cualquier dato de la tarea (título, detalle, fecha, cliente) o la reasigna a otra persona.
router.patch('/:id', async (req, res) => {
  const r = tareaCambiosSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const ref = tareas().doc(req.params.id);
  const actual = await ref.get();
  if (!actual.exists) return res.status(404).json({ error: 'Tarea no encontrada' });
  const { detalles, asignado } = await validarReferencias({ clienteId: r.data.clienteId, asignadoA: r.data.asignadoA });
  if (detalles) return res.status(400).json({ error: 'Datos inválidos', detalles });

  const { hecha, ...resto } = r.data;
  const cambios = { ...resto };
  if (hecha !== undefined) {
    cambios.hecha = hecha;
    cambios.hechaEn = hecha ? new Date() : null;
  }
  Object.assign(cambios, alertaTarea({ ...actual.data(), ...cambios }));
  await ref.update(cambios);

  // Solo se avisa si cambió el responsable (editar el título o la fecha no vuelve a enviar nada).
  const cambioResponsable = cambios.asignadoA && cambios.asignadoA !== actual.data().asignadoA;
  const [doc, clientes, usuarios] = await Promise.all([ref.get(), mapaClientes(), mapaUsuarios()]);
  const tarea = aObjeto(doc);
  const aviso = cambioResponsable
    ? await avisarAsignacion({ tarea, asignado, actor: await usuarioActual(req.usuario.id), clienteNombre: await nombreCliente(tarea.clienteId) })
    : null;
  res.json({ ...salida(tarea, clientes, usuarios), aviso });
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
