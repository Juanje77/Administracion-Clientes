const router = require('express').Router();
const prisma = require('../db');
const { requiereAdmin } = require('../middleware/auth');
const { clienteSchema, interaccionSchema } = require('../validacion');

const COLUMNAS_ORDEN = ['razonSocial', 'cuit', 'email', 'telefono', 'ciudad', 'estado', 'creadoEn'];
const incluir = { etiquetas: true };

function errorValidacion(res, error) {
  return res.status(400).json({ error: 'Datos inválidos', detalles: error.flatten().fieldErrors });
}

// Convierte la lista de nombres de etiquetas en conexiones (creándolas si no existen).
function conectarEtiquetas(nombres = []) {
  const unicos = [...new Set(nombres.map((n) => n.toLowerCase()))];
  return unicos.map((nombre) => ({
    where: { nombre },
    create: { nombre },
  }));
}

// Mapea la violación de unicidad (P2002) a un mensaje claro.
function manejarDuplicado(err, res) {
  if (err.code === 'P2002') return res.status(409).json({ error: 'Ya existe un cliente con ese CUIT' });
  throw err;
}

router.get('/', async (req, res) => {
  const { q, estado, ciudad, etiqueta, orden = 'razonSocial', dir = 'asc' } = req.query;
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const porPagina = Math.min(100, Math.max(1, Number(req.query.porPagina) || 25));

  const where = {};
  if (q) {
    where.OR = ['razonSocial', 'email', 'telefono', 'cuit'].map((c) => ({
      [c]: { contains: String(q), mode: 'insensitive' },
    }));
  }
  if (['ACTIVO', 'INACTIVO', 'POTENCIAL'].includes(estado)) where.estado = estado;
  if (ciudad) where.ciudad = { equals: String(ciudad), mode: 'insensitive' };
  if (etiqueta) where.etiquetas = { some: { nombre: String(etiqueta).toLowerCase() } };

  const campoOrden = COLUMNAS_ORDEN.includes(orden) ? orden : 'razonSocial';
  const [total, datos] = await Promise.all([
    prisma.cliente.count({ where }),
    prisma.cliente.findMany({
      where,
      include: incluir,
      orderBy: { [campoOrden]: dir === 'desc' ? 'desc' : 'asc' },
      skip: (pagina - 1) * porPagina,
      take: porPagina,
    }),
  ]);
  res.json({ total, pagina, porPagina, datos });
});

router.get('/ciudades', async (_req, res) => {
  const filas = await prisma.cliente.findMany({
    where: { ciudad: { not: null } },
    select: { ciudad: true },
    distinct: ['ciudad'],
    orderBy: { ciudad: 'asc' },
  });
  res.json(filas.map((f) => f.ciudad));
});

router.get('/etiquetas', async (_req, res) => {
  res.json(await prisma.etiqueta.findMany({ orderBy: { nombre: 'asc' } }));
});

router.post('/', async (req, res) => {
  const r = clienteSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const { etiquetas, ...datos } = r.data;
  try {
    const c = await prisma.cliente.create({
      data: { ...datos, etiquetas: { connectOrCreate: conectarEtiquetas(etiquetas) } },
      include: incluir,
    });
    res.status(201).json(c);
  } catch (e) {
    manejarDuplicado(e, res);
  }
});

router.get('/:id', async (req, res) => {
  const c = await prisma.cliente.findUnique({ where: { id: Number(req.params.id) }, include: incluir });
  if (!c) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(c);
});

router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const r = clienteSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  if (!(await prisma.cliente.findUnique({ where: { id } }))) {
    return res.status(404).json({ error: 'Cliente no encontrado' });
  }
  const { etiquetas, ...datos } = r.data;
  try {
    const c = await prisma.cliente.update({
      where: { id },
      data: { ...datos, etiquetas: { set: [], connectOrCreate: conectarEtiquetas(etiquetas) } },
      include: incluir,
    });
    res.json(c);
  } catch (e) {
    manejarDuplicado(e, res);
  }
});

// Por defecto se archiva (estado INACTIVO); solo un administrador puede borrar definitivamente.
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await prisma.cliente.findUnique({ where: { id } }))) {
    return res.status(404).json({ error: 'Cliente no encontrado' });
  }
  if (req.query.definitivo === 'true') {
    return requiereAdmin(req, res, async () => {
      await prisma.cliente.delete({ where: { id } });
      res.status(204).end();
    });
  }
  res.json(await prisma.cliente.update({ where: { id }, data: { estado: 'INACTIVO' }, include: incluir }));
});

// ---- Historial de interacciones ----
router.get('/:id/interacciones', async (req, res) => {
  res.json(
    await prisma.interaccion.findMany({
      where: { clienteId: Number(req.params.id) },
      include: { usuario: { select: { id: true, nombre: true } } },
      orderBy: { fecha: 'desc' },
    })
  );
});

router.post('/:id/interacciones', async (req, res) => {
  const clienteId = Number(req.params.id);
  const r = interaccionSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  if (!(await prisma.cliente.findUnique({ where: { id: clienteId } }))) {
    return res.status(404).json({ error: 'Cliente no encontrado' });
  }
  const i = await prisma.interaccion.create({
    data: { ...r.data, clienteId, usuarioId: req.usuario.id },
    include: { usuario: { select: { id: true, nombre: true } } },
  });
  res.status(201).json(i);
});

router.delete('/:id/interacciones/:iid', async (req, res) => {
  const i = await prisma.interaccion.findFirst({
    where: { id: Number(req.params.iid), clienteId: Number(req.params.id) },
  });
  if (!i) return res.status(404).json({ error: 'Interacción no encontrada' });
  if (i.usuarioId !== req.usuario.id && req.usuario.rol !== 'ADMIN') {
    return res.status(403).json({ error: 'Solo el autor o un administrador puede borrarla' });
  }
  await prisma.interaccion.delete({ where: { id: i.id } });
  res.status(204).end();
});

module.exports = router;
