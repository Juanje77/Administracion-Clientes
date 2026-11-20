// Sección "CUIT y claves": CUIT y claves de ARCA y de Rentas de cada cliente. Solo para quien tiene ese permiso (los
// administradores siempre) y solo de los clientes que puede ver.
const router = require('express').Router();
const { requiereClaves } = require('../middleware/auth');
const { clientesVisibles } = require('../servicios/acceso');
const claves = require('../servicios/claves');
const { clavesSchema } = require('../validacion');

const sinCache = (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };

router.use(sinCache, requiereClaves);

const fila = (c, k) => ({ id: c.id, razonSocial: c.razonSocial, cuit: c.cuit ?? null, estado: c.estado, arca: k?.arca ?? null, rentas: k?.rentas ?? null });

router.get('/', async (req, res) => {
  const [lista, cargadas] = await Promise.all([clientesVisibles(req.usuario), claves.todas()]);
  res.json(lista.map((c) => fila(c, cargadas.get(c.id))).sort((a, b) => a.razonSocial.localeCompare(b.razonSocial, 'es')));
});

// Cargar, cambiar o borrar claves (cadena vacía = borrar; campo ausente = sin cambios)
router.put('/:clienteId', async (req, res) => {
  const r = clavesSchema.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: 'Datos inválidos', detalles: r.error.flatten().fieldErrors });
  const cliente = (await clientesVisibles(req.usuario)).find((c) => c.id === req.params.clienteId);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  await claves.guardar(req.params.clienteId, r.data, req.usuario.id);
  res.json(fila(cliente, (await claves.todas()).get(cliente.id)));
});

module.exports = router;
