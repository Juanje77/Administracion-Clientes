const router = require('express').Router();
const { db, aObjeto } = require('../db');
const { todosLosClientes, invalidar } = require('../cache');
const { requiereAdmin } = require('../middleware/auth');
const { clienteSchema, interaccionSchema } = require('../validacion');

const COLUMNAS_ORDEN = ['razonSocial', 'cuit', 'email', 'telefono', 'ciudad', 'estado', 'creadoEn'];
const clientes = () => db.collection('clientes');

function errorValidacion(res, error) {
  return res.status(400).json({ error: 'Datos inválidos', detalles: error.flatten().fieldErrors });
}

// Minúsculas y sin tildes: "García" se encuentra buscando "garcia".
const plano = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const claveCuit = (cuit) => (cuit ? String(cuit).replace(/\D/g, '') : null);
const normalizarEtiquetas = (lista = []) => [...new Set(lista.map((n) => n.toLowerCase()))].sort();

// Respuesta de la API: las etiquetas se muestran como objetos { nombre }.
const salida = (c) => ({ ...c, obligaciones: c.obligaciones || [], etiquetas: (c.etiquetas || []).map((nombre) => ({ nombre })) });

// El CUIT es único: se reserva un documento cuits/{11 dígitos} dentro de una transacción.
class CuitDuplicado extends Error {}
const refCuit = (clave) => db.collection('cuits').doc(clave);

router.get('/', async (req, res) => {
  const { q, estado, ciudad, etiqueta, orden = 'razonSocial', dir = 'asc' } = req.query;
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const porPagina = Math.min(100, Math.max(1, Number(req.query.porPagina) || 25));

  let lista = await todosLosClientes();
  if (q) {
    const buscado = plano(q);
    lista = lista.filter((c) => ['razonSocial', 'email', 'telefono', 'cuit'].some((k) => plano(c[k]).includes(buscado)));
  }
  if (['ACTIVO', 'INACTIVO', 'POTENCIAL'].includes(estado)) lista = lista.filter((c) => c.estado === estado);
  if (ciudad) lista = lista.filter((c) => plano(c.ciudad) === plano(ciudad));
  if (etiqueta) lista = lista.filter((c) => (c.etiquetas || []).includes(String(etiqueta).toLowerCase()));

  const campo = COLUMNAS_ORDEN.includes(orden) ? orden : 'razonSocial';
  const signo = dir === 'desc' ? -1 : 1;
  const ordenada = [...lista].sort((a, b) => {
    const x = a[campo], y = b[campo];
    if (x == null && y == null) return 0;
    if (x == null) return 1; // los vacíos siempre al final
    if (y == null) return -1;
    if (x instanceof Date) return signo * (x - y);
    return signo * String(x).localeCompare(String(y), 'es', { sensitivity: 'base', numeric: true });
  });

  res.json({
    total: ordenada.length,
    pagina,
    porPagina,
    datos: ordenada.slice((pagina - 1) * porPagina, pagina * porPagina).map(salida),
  });
});

router.get('/ciudades', async (_req, res) => {
  const ciudades = new Set((await todosLosClientes()).map((c) => c.ciudad).filter(Boolean));
  res.json([...ciudades].sort((a, b) => a.localeCompare(b, 'es')));
});

router.get('/etiquetas', async (_req, res) => {
  const nombres = new Set((await todosLosClientes()).flatMap((c) => c.etiquetas || []));
  res.json([...nombres].sort().map((nombre) => ({ id: nombre, nombre })));
});

router.post('/', async (req, res) => {
  const r = clienteSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const { etiquetas, ...datos } = r.data;
  const ahora = new Date();
  const ref = clientes().doc();
  const nuevo = { ...datos, obligaciones: datos.obligaciones ?? [], etiquetas: normalizarEtiquetas(etiquetas), creadoEn: ahora, actualizadoEn: ahora };
  const clave = claveCuit(datos.cuit);
  try {
    await db.runTransaction(async (tx) => {
      if (clave) {
        if ((await tx.get(refCuit(clave))).exists) throw new CuitDuplicado();
        tx.set(refCuit(clave), { clienteId: ref.id });
      }
      tx.set(ref, nuevo);
    });
  } catch (e) {
    if (e instanceof CuitDuplicado) return res.status(409).json({ error: 'Ya existe un cliente con ese CUIT' });
    throw e;
  }
  invalidar();
  res.status(201).json(salida({ id: ref.id, ...nuevo }));
});

router.get('/:id', async (req, res) => {
  const doc = await clientes().doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(salida(aObjeto(doc)));
});

router.put('/:id', async (req, res) => {
  const r = clienteSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const ref = clientes().doc(req.params.id);
  const { etiquetas, ...datos } = r.data;
  const claveNueva = claveCuit(datos.cuit);
  try {
    const resultado = await db.runTransaction(async (tx) => {
      const actual = await tx.get(ref);
      if (!actual.exists) return null;
      const claveVieja = claveCuit(actual.data().cuit);
      if (claveNueva !== claveVieja) {
        if (claveNueva) {
          if ((await tx.get(refCuit(claveNueva))).exists) throw new CuitDuplicado();
          tx.set(refCuit(claveNueva), { clienteId: ref.id });
        }
        if (claveVieja) tx.delete(refCuit(claveVieja));
      }
      const cambios = { ...datos, etiquetas: normalizarEtiquetas(etiquetas), actualizadoEn: new Date() };
      tx.update(ref, cambios);
      return { ...actual.data(), ...cambios };
    });
    if (!resultado) return res.status(404).json({ error: 'Cliente no encontrado' });
    invalidar();
    res.json(salida({ id: ref.id, ...resultado }));
  } catch (e) {
    if (e instanceof CuitDuplicado) return res.status(409).json({ error: 'Ya existe un cliente con ese CUIT' });
    throw e;
  }
});

// Por defecto se archiva (estado INACTIVO); solo un administrador puede borrar definitivamente.
router.delete('/:id', async (req, res) => {
  const ref = clientes().doc(req.params.id);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Cliente no encontrado' });
  if (req.query.definitivo === 'true') {
    return requiereAdmin(req, res, async () => {
      const clave = claveCuit(doc.data().cuit);
      await db.recursiveDelete(ref); // borra también el historial (subcolección)
      for (const col of ['tareas', 'vencimientos']) {
        const huerfanos = await db.collection(col).where('clienteId', '==', req.params.id).get();
        await Promise.all(huerfanos.docs.map((d) => d.ref.delete()));
      }
      if (clave) await refCuit(clave).delete();
      invalidar();
      res.status(204).end();
    });
  }
  await ref.update({ estado: 'INACTIVO', actualizadoEn: new Date() });
  invalidar();
  res.json(salida(aObjeto(await ref.get())));
});

// ---- Historial de interacciones (subcolección clientes/{id}/interacciones) ----
const interacciones = (clienteId) => clientes().doc(clienteId).collection('interacciones');
const salidaInteraccion = (i) => {
  const { usuarioId, usuarioNombre, ...resto } = i;
  return { ...resto, usuario: { id: usuarioId, nombre: usuarioNombre } };
};

router.get('/:id/interacciones', async (req, res) => {
  const snap = await interacciones(req.params.id).orderBy('fecha', 'desc').get();
  res.json(snap.docs.map((d) => salidaInteraccion(aObjeto(d))));
});

router.post('/:id/interacciones', async (req, res) => {
  const r = interaccionSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  if (!(await clientes().doc(req.params.id).get()).exists) {
    return res.status(404).json({ error: 'Cliente no encontrado' });
  }
  const autor = await db.collection('usuarios').doc(req.usuario.id).get();
  const nueva = {
    ...r.data,
    fecha: r.data.fecha ?? new Date(),
    usuarioId: req.usuario.id,
    usuarioNombre: autor.data().nombre,
  };
  const ref = await interacciones(req.params.id).add(nueva);
  res.status(201).json(salidaInteraccion({ id: ref.id, ...nueva }));
});

router.delete('/:id/interacciones/:iid', async (req, res) => {
  const ref = interacciones(req.params.id).doc(req.params.iid);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Interacción no encontrada' });
  if (doc.data().usuarioId !== req.usuario.id && req.usuario.rol !== 'ADMIN') {
    return res.status(403).json({ error: 'Solo el autor o un administrador puede borrarla' });
  }
  await ref.delete();
  res.status(204).end();
});

module.exports = router;
