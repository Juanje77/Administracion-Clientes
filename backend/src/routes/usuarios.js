const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { requiereAdmin } = require('../middleware/auth');
const { usuarioSchema } = require('../validacion');

const publico = (id, u) => ({ id, nombre: u.nombre, email: u.email, rol: u.rol, activo: u.activo });

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

// Activar/desactivar usuario (no se borra para conservar el historial).
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  if (id === req.usuario.id) return res.status(400).json({ error: 'No puedes modificarte a ti mismo' });
  const ref = db.collection('usuarios').doc(id);
  if (!(await ref.get()).exists) return res.status(404).json({ error: 'Usuario no encontrado' });
  await ref.update({ activo: Boolean(req.body.activo) });
  res.json(publico(id, (await ref.get()).data()));
});

module.exports = router;
