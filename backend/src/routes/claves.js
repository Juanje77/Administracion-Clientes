// Sección "Claves": CUIT y claves de ARCA y de Rentas de cada cliente. Solo para quien tiene ese permiso (los
// administradores siempre) y solo de los clientes que puede ver. Las claves se ven de a una por vez y cada acceso queda
// registrado (quién, cuándo y de qué cliente).
const router = require('express').Router();
const { db, aObjeto } = require('../db');
const { requiereAdmin, requiereClaves } = require('../middleware/auth');
const { clientesVisibles, puedeVerCliente } = require('../servicios/acceso');
const claves = require('../servicios/claves');
const { clavesSchema } = require('../validacion');

const accesos = () => db.collection('accesosClaves');
const sinCache = (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };
const NOMBRE = { arca: 'ARCA', rentas: 'Rentas' };

router.use(sinCache, requiereClaves);

// Registro de accesos: solo administradores (se declara antes de las rutas con :id)
router.get('/accesos', requiereAdmin, async (_req, res) => {
  const snap = await accesos().orderBy('fecha', 'desc').limit(100).get();
  res.json(snap.docs.map(aObjeto));
});

async function registrar(req, tipo, cliente, campo) {
  await accesos().add({ tipo, campo, clienteId: cliente.id, clienteNombre: cliente.razonSocial, usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre, fecha: new Date() });
}

// Lista de clientes con su CUIT y qué claves tienen cargadas (nunca las claves en sí)
router.get('/', async (req, res) => {
  const [lista, cargadas] = await Promise.all([clientesVisibles(req.usuario), claves.resumen()]);
  res.json(lista
    .map((c) => ({ id: c.id, razonSocial: c.razonSocial, cuit: c.cuit ?? null, estado: c.estado, arca: cargadas.get(c.id)?.arca ?? false, rentas: cargadas.get(c.id)?.rentas ?? false }))
    .sort((a, b) => a.razonSocial.localeCompare(b.razonSocial, 'es')));
});

// Una clave en texto, para mostrarla o copiarla
router.get('/:clienteId/:campo', async (req, res) => {
  const { clienteId, campo } = req.params;
  if (!claves.CAMPOS.includes(campo)) return res.status(400).json({ error: 'Clave desconocida' });
  const cliente = (await clientesVisibles(req.usuario)).find((c) => c.id === clienteId);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  const valor = await claves.leer(clienteId, campo);
  if (valor === null) return res.status(404).json({ error: `No hay clave de ${NOMBRE[campo]} cargada` });
  await registrar(req, 'ver', cliente, campo);
  res.json({ clave: valor });
});

// Cargar, cambiar o borrar claves (cadena vacía = borrar; campo ausente = sin cambios)
router.put('/:clienteId', async (req, res) => {
  const r = clavesSchema.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: 'Datos inválidos', detalles: r.error.flatten().fieldErrors });
  if (!(await puedeVerCliente(req.usuario, req.params.clienteId))) return res.status(404).json({ error: 'Cliente no encontrado' });
  const cliente = (await clientesVisibles(req.usuario)).find((c) => c.id === req.params.clienteId);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  await claves.guardar(req.params.clienteId, r.data, req.usuario.id);
  for (const c of claves.CAMPOS) if (r.data[c] !== undefined) await registrar(req, r.data[c] === '' ? 'borrar' : 'editar', cliente, c);
  const cargadas = (await claves.resumen()).get(req.params.clienteId) ?? { arca: false, rentas: false };
  res.json({ id: cliente.id, ...cargadas });
});

module.exports = router;
