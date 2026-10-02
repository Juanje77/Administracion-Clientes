const router = require('express').Router();
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { requiereAdmin } = require('../middleware/auth');
const { usuarioSchema } = require('../validacion');

const publico = { id: true, nombre: true, email: true, rol: true, activo: true };

router.use(requiereAdmin);

router.get('/', async (_req, res) => {
  res.json(await prisma.usuario.findMany({ select: publico, orderBy: { nombre: 'asc' } }));
});

router.post('/', async (req, res) => {
  const r = usuarioSchema.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: 'Datos inválidos', detalles: r.error.flatten().fieldErrors });
  const { password, ...datos } = r.data;
  if (await prisma.usuario.findUnique({ where: { email: datos.email } })) {
    return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
  }
  const u = await prisma.usuario.create({
    data: { ...datos, passwordHash: await bcrypt.hash(password, 12) },
    select: publico,
  });
  res.status(201).json(u);
});

// Activar/desactivar usuario (no se borra para conservar el historial).
router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuario.id) return res.status(400).json({ error: 'No puedes modificarte a ti mismo' });
  const activo = Boolean(req.body.activo);
  res.json(await prisma.usuario.update({ where: { id }, data: { activo }, select: publico }));
});

module.exports = router;
