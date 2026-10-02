const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requiereAdmin, olvidarUsuario } = require('../middleware/auth');
const { usuarioSchema, usuarioCambiosSchema } = require('../validacion');
const { puedeVerDinero, veTodosLosClientes } = require('../permisos');
const { todosLosClientes, invalidar } = require('../cache');
const { FieldValue } = require('firebase-admin/firestore');

// verDinero = acceso efectivo (los administradores siempre lo tienen)
// verDinero / todosLosClientes = acceso efectivo (los administradores siempre lo tienen todo)
const publico = (id, u) => ({ id, nombre: u.nombre, email: u.email, rol: u.rol, activo: u.activo, verDinero: puedeVerDinero(u), todosLosClientes: veTodosLosClientes(u) });

// Lista mínima del equipo (para asignar tareas); disponible para cualquier usuario con sesión.
router.get('/equipo', async (_req, res) => {
  const snap = await db.collection('usuarios').where('activo', '==', true).get();
  const lista = snap.docs.map((d) => ({ id: d.id, nombre: d.data().nombre }));
  res.json(lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
});

router.use(requiereAdmin);

router.get('/', async (_req, res) => {
  const snap = await db.collection('usuarios').get();
  const lista = snap.docs.map((d) => publico(d.id, d.data()));
  res.json(lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
});

router.post('/', async (req, res) => {
  const r = usuarioSchema.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: 'Datos inválidos', detalles: r.error.flatten().fieldErrors });
  const { password, ...datos } = r.data;
  const passwordHash = await bcrypt.hash(password, 12);
  const ref = db.collection('usuarios').doc();
  const nuevo = { ...datos, passwordHash, activo: true, creadoEn: new Date() };
  // La transacción evita que dos altas simultáneas repitan el email.
  const creado = await db.runTransaction(async (tx) => {
    const existe = await tx.get(db.collection('usuarios').where('email', '==', datos.email).limit(1));
    if (!existe.empty) return false;
    tx.set(ref, nuevo);
    return true;
  });
  if (!creado) return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
  res.status(201).json(publico(ref.id, nuevo));
});

// Activar/desactivar un usuario (no se borra, para conservar el historial) y darle o quitarle el acceso a los montos.
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  if (id === req.usuario.id) return res.status(400).json({ error: 'No puedes modificarte a ti mismo' });
  const r = usuarioCambiosSchema.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: 'Datos inválidos' });
  const ref = db.collection('usuarios').doc(id);
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Usuario no encontrado' });
  await ref.update(r.data);
  olvidarUsuario(id); // el cambio vale desde la próxima petición de esa persona
  res.json(publico(id, (await ref.get()).data()));
});

// ---- Clientes asignados a una persona (la otra cara de "responsables" en la ficha del cliente) ----
router.get('/:id/clientes', async (req, res) => {
  if (!(await db.collection('usuarios').doc(req.params.id).get()).exists) return res.status(404).json({ error: 'Usuario no encontrado' });
  const asignados = (await todosLosClientes()).filter((c) => (c.responsables || []).includes(req.params.id));
  res.json(asignados.map((c) => ({ id: c.id, razonSocial: c.razonSocial })).sort((a, b) => a.razonSocial.localeCompare(b.razonSocial, 'es')));
});

// Reemplaza la lista de clientes de esa persona: agrega y quita su id de `responsables` solo donde cambió.
router.put('/:id/clientes', async (req, res) => {
  const { id } = req.params;
  const pedidos = req.body.clienteIds;
  if (!Array.isArray(pedidos) || pedidos.some((x) => typeof x !== 'string')) return res.status(400).json({ error: 'Datos inválidos' });
  if (!(await db.collection('usuarios').doc(id).get()).exists) return res.status(404).json({ error: 'Usuario no encontrado' });
  const todos = await todosLosClientes();
  const existentes = new Set(todos.map((c) => c.id));
  if (pedidos.some((x) => !existentes.has(x))) return res.status(400).json({ error: 'Alguno de los clientes no existe' });

  const quiere = new Set(pedidos);
  const tiene = new Set(todos.filter((c) => (c.responsables || []).includes(id)).map((c) => c.id));
  const altas = [...quiere].filter((x) => !tiene.has(x));
  const bajas = [...tiene].filter((x) => !quiere.has(x));
  const cambios = [
    ...altas.map((c) => [c, FieldValue.arrayUnion(id)]),
    ...bajas.map((c) => [c, FieldValue.arrayRemove(id)]),
  ];
  for (let i = 0; i < cambios.length; i += 400) {
    const lote = db.batch();
    for (const [c, valor] of cambios.slice(i, i + 400)) lote.update(db.collection('clientes').doc(c), { responsables: valor, actualizadoEn: new Date() });
    await lote.commit();
  }
  if (cambios.length) await invalidar();
  res.json({ asignados: quiere.size, agregados: altas.length, quitados: bajas.length });
});

module.exports = router;
