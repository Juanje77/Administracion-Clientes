const router = require('express').Router();
const { db, aObjeto } = require('../db');
const { todosLosClientes } = require('../cache');
const { tareaSchema, tareaCambiosSchema } = require('../validacion');
const { idsVisibles, visiblePara, puedeVerCliente, exigirCliente, comoAcceso } = require('../servicios/acceso');
const { avisarAsignacion } = require('../servicios/asignaciones');
const { hoy, sumarDias, situacion, mapaClientes, mapaUsuarios, porFecha, alertaTarea, siguienteFecha, diasAgenda, LIMITE_AGENDA } = require('../util');

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
  const { clienteId } = req.query;
  // La Agenda del equipo entero (o de otra persona) es solo para administradores: el resto ve únicamente sus tareas.
  const asignado = req.usuario.rol === 'ADMIN' || clienteId ? req.query.asignado : 'yo';
  const limite = sumarDias(hoy(), diasAgenda(req.query.dias));
  if (clienteId && !(await exigirCliente(req, res, String(clienteId)))) return;
  let consulta = tareas();
  if (clienteId) consulta = consulta.where('clienteId', '==', String(clienteId));
  else if (asignado) {
    const quien = asignado === 'yo' ? req.usuario.id : String(asignado);
    consulta = consulta.where('alertaDe', '>=', `${quien}|`).where('alertaDe', '<=', `${quien}|${limite}`).limit(LIMITE_AGENDA);
  } else consulta = consulta.where('alerta', '<=', limite).orderBy('alerta').limit(LIMITE_AGENDA);

  const [snap, clientes, usuarios] = await Promise.all([consulta.get(), mapaClientes(), mapaUsuarios()]);
  const ids = await idsVisibles(req.usuario);
  let lista = snap.docs.map(aObjeto).filter((t) => visiblePara(ids, t.clienteId));
  if (clienteId && asignado) lista = lista.filter((t) => t.asignadoA === (asignado === 'yo' ? req.usuario.id : String(asignado)));
  lista = lista.map((t) => salida(t, clientes, usuarios));
  // Pendientes primero (por fecha), luego las hechas (las más recientes arriba).
  lista.sort((a, b) => a.hecha - b.hecha || (a.hecha ? b.vence.localeCompare(a.vence) : porFecha(a, b)));
  res.json(lista);
});

// Valida que el cliente (si lo hay) y el responsable existan; el responsable debe estar activo.
// Con cliente: quien la crea y quien la recibe deben poder ver ese cliente (si no, primero hay que darle acceso).
async function validarReferencias({ clienteId, asignadoA, actor }) {
  const detalles = {};
  if (clienteId && (!(await db.collection('clientes').doc(clienteId).get()).exists || !(await puedeVerCliente(actor, clienteId)))) detalles.clienteId = ['El cliente no existe'];
  let asignado = null;
  if (asignadoA) {
    const doc = await db.collection('usuarios').doc(asignadoA).get();
    if (!doc.exists || doc.data().activo === false) detalles.asignadoA = ['La persona elegida no existe o está desactivada'];
    else {
      asignado = { id: doc.id, ...doc.data() };
      if (clienteId && !detalles.clienteId && !(await puedeVerCliente(comoAcceso(asignado), clienteId))) {
        detalles.asignadoA = ['Esa persona no tiene acceso a este cliente. Dale acceso al cliente primero o elegí a otra persona'];
      }
    }
  }
  return { detalles: Object.keys(detalles).length ? detalles : null, asignado };
}

const usuarioActual = async (id) => ({ id, ...(await db.collection('usuarios').doc(id).get()).data() });
const nombreCliente = async (clienteId) => (clienteId ? (await mapaClientes()).get(clienteId) ?? null : null);

router.post('/', async (req, res) => {
  const r = tareaSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const asignadoA = r.data.asignadoA ?? req.usuario.id; // por defecto, quien la crea
  const { detalles, asignado } = await validarReferencias({ clienteId: r.data.clienteId, asignadoA, actor: req.usuario });
  if (detalles) return res.status(400).json({ error: 'Datos inválidos', detalles });

  const nueva = {
    ...r.data,
    clienteId: r.data.clienteId ?? null,
    descripcion: r.data.descripcion ?? null,
    asignadoA,
    repite: r.data.repite ?? 'NINGUNA',
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
  if (!actual.exists || !(await puedeVerCliente(req.usuario, actual.data().clienteId))) return res.status(404).json({ error: 'Tarea no encontrada' });
  // si cambia el cliente o el responsable se revalida la combinación completa
  const nuevoCliente = r.data.clienteId !== undefined ? r.data.clienteId : actual.data().clienteId;
  const nuevoResp = r.data.asignadoA ?? actual.data().asignadoA;
  const revalidar = r.data.clienteId !== undefined || (r.data.asignadoA && r.data.asignadoA !== actual.data().asignadoA);
  const { detalles, asignado } = await validarReferencias({ clienteId: revalidar ? nuevoCliente : undefined, asignadoA: revalidar ? nuevoResp : r.data.asignadoA, actor: req.usuario });
  if (detalles) return res.status(400).json({ error: 'Datos inválidos', detalles });

  const { hecha, ...resto } = r.data;
  const cambios = { ...resto };
  if (hecha !== undefined) {
    cambios.hecha = hecha;
    cambios.hechaEn = hecha ? new Date() : null;
  }
  // Recurrente: al completarla (por primera vez) nace la siguiente, con la fecha corrida y la misma persona.
  const repite = cambios.repite ?? actual.data().repite ?? 'NINGUNA';
  let siguiente = null;
  if (hecha === true && !actual.data().hecha && !actual.data().siguienteId && repite !== 'NINGUNA') {
    const base = { ...actual.data(), ...cambios };
    const proxima = {
      clienteId: base.clienteId ?? null, titulo: base.titulo, descripcion: base.descripcion ?? null, vence: siguienteFecha(base.vence, repite),
      asignadoA: base.asignadoA, repite, hecha: false, hechaEn: null, creadoPor: base.creadoPor, creadoEn: new Date(), origenId: ref.id,
    };
    Object.assign(proxima, alertaTarea(proxima));
    const nuevaRef = tareas().doc();
    await nuevaRef.set(proxima);
    cambios.siguienteId = nuevaRef.id;
    siguiente = { id: nuevaRef.id, vence: proxima.vence };
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
  res.json({ ...salida(tarea, clientes, usuarios), aviso, siguiente });
});

router.delete('/:id', async (req, res) => {
  const ref = tareas().doc(req.params.id);
  const doc = await ref.get();
  if (!doc.exists || !(await puedeVerCliente(req.usuario, doc.data().clienteId))) return res.status(404).json({ error: 'Tarea no encontrada' });
  if (doc.data().creadoPor !== req.usuario.id && req.usuario.rol !== 'ADMIN') {
    return res.status(403).json({ error: 'Solo quien la creó o un administrador puede borrarla' });
  }
  await ref.delete();
  res.status(204).end();
});

module.exports = router;
