const router = require('express').Router();
const { db, aObjeto } = require('../db');
const { borrarDocumentosDeCliente } = require('./documentos');
const { borrarHonorarios } = require('../servicios/resumenes');
const { invalidar } = require('../cache');
const { requiereAdmin } = require('../middleware/auth');
const { clienteSchema, interaccionSchema } = require('../validacion');
const { filtrarYOrdenar } = require('../servicios/clientes');
const { sincronizarCliente } = require('../servicios/calendario');
const { clientesVisibles, puedeVerCliente } = require('../servicios/acceso');

const clientes = () => db.collection('clientes');

function errorValidacion(res, error) {
  return res.status(400).json({ error: 'Datos inválidos', detalles: error.flatten().fieldErrors });
}

const claveCuit = (cuit) => (cuit ? String(cuit).replace(/\D/g, '') : null);
const normalizarEtiquetas = (lista = []) => [...new Set(lista.map((n) => n.toLowerCase()))].sort();

// Respuesta de la API: las etiquetas se muestran como objetos { nombre }.
// El abono mensual es dinero: solo lo ven quienes tienen ese acceso.
// Quién puede ver el cliente (responsables) solo lo ve un administrador.
const salida = (c, usuario) => {
  const out = { ...c, obligaciones: c.obligaciones || [], etiquetas: (c.etiquetas || []).map((nombre) => ({ nombre })) };
  if (!usuario.verDinero) delete out.abonoMensual;
  if (usuario.rol === 'ADMIN') out.responsables = c.responsables || [];
  else delete out.responsables;
  return out;
};

// Solo ids de usuarios activos y no administradores (los administradores ven todo, no se asignan).
async function responsablesValidos(ids) {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return [];
  const docs = await db.getAll(...unicos.map((id) => db.collection('usuarios').doc(id)));
  const invalidos = unicos.filter((id, i) => !docs[i].exists || docs[i].data().rol === 'ADMIN' || docs[i].data().activo === false);
  if (invalidos.length) return { error: 'Hay personas que no existen, están desactivadas o son administradoras' };
  return unicos;
}

// Un cliente que la persona no puede ver es, para ella, un cliente inexistente.
router.param('id', async (req, res, next, id) => {
  if (await puedeVerCliente(req.usuario, id)) return next();
  res.status(404).json({ error: 'Cliente no encontrado' });
});

// El CUIT es único: se reserva un documento cuits/{11 dígitos} dentro de una transacción.
class CuitDuplicado extends Error {}
const refCuit = (clave) => db.collection('cuits').doc(clave);

router.get('/', async (req, res) => {
  const pagina = Math.max(1, Number(req.query.pagina) || 1);
  const porPagina = Math.min(100, Math.max(1, Number(req.query.porPagina) || 25));
  const lista = filtrarYOrdenar(await clientesVisibles(req.usuario), req.query);
  res.json({
    total: lista.length,
    pagina,
    porPagina,
    datos: lista.slice((pagina - 1) * porPagina, pagina * porPagina).map((c) => salida(c, req.usuario)),
  });
});

router.get('/ciudades', async (req, res) => {
  const ciudades = new Set((await clientesVisibles(req.usuario)).map((c) => c.ciudad).filter(Boolean));
  res.json([...ciudades].sort((a, b) => a.localeCompare(b, 'es')));
});

router.get('/etiquetas', async (req, res) => {
  const nombres = new Set((await clientesVisibles(req.usuario)).flatMap((c) => c.etiquetas || []));
  res.json([...nombres].sort().map((nombre) => ({ id: nombre, nombre })));
});

router.post('/', async (req, res) => {
  const r = clienteSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const { etiquetas, ...datos } = r.data;
  if (!req.usuario.verDinero) delete datos.abonoMensual; // no puede fijar el abono
  if (req.usuario.rol === 'ADMIN') {
    const resp = await responsablesValidos(datos.responsables ?? []);
    if (resp.error) return res.status(400).json({ error: 'Datos inválidos', detalles: { responsables: [resp.error] } });
    datos.responsables = resp;
  } else {
    // quien tiene acceso limitado no se queda sin ver el cliente que acaba de crear
    datos.responsables = req.usuario.todosLosClientes ? [] : [req.usuario.id];
  }
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
  await invalidar();
  const calendario = await sincronizarCliente({ id: ref.id, ...nuevo });
  res.status(201).json({ ...salida({ id: ref.id, ...nuevo }, req.usuario), calendario });
});

router.get('/:id', async (req, res) => {
  const doc = await clientes().doc(req.params.id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(salida(aObjeto(doc), req.usuario));
});

router.put('/:id', async (req, res) => {
  const r = clienteSchema.safeParse(req.body);
  if (!r.success) return errorValidacion(res, r.error);
  const ref = clientes().doc(req.params.id);
  const { etiquetas, ...datos } = r.data;
  if (!req.usuario.verDinero) delete datos.abonoMensual; // conserva el abono que ya tenía
  if (req.usuario.rol === 'ADMIN') {
    if (datos.responsables) {
      const resp = await responsablesValidos(datos.responsables);
      if (resp.error) return res.status(400).json({ error: 'Datos inválidos', detalles: { responsables: [resp.error] } });
      datos.responsables = resp;
    }
  } else {
    delete datos.responsables; // solo un administrador cambia quién ve el cliente
  }
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
    await invalidar();
    const calendario = await sincronizarCliente({ id: ref.id, ...resultado });
    res.json({ ...salida({ id: ref.id, ...resultado }, req.usuario), calendario });
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
      await borrarDocumentosDeCliente(req.params.id);
      await borrarHonorarios((await db.collection('honorarios').where('clienteId', '==', req.params.id).get()).docs); // con sus cobros y totales
      for (const col of ['tareas', 'vencimientos', 'pagos']) {
        const huerfanos = await db.collection(col).where('clienteId', '==', req.params.id).get();
        await Promise.all(huerfanos.docs.map((d) => d.ref.delete()));
      }
      if (clave) await refCuit(clave).delete();
      await invalidar();
      res.status(204).end();
    });
  }
  await ref.update({ estado: 'INACTIVO', actualizadoEn: new Date() });
  await invalidar();
  res.json(salida(aObjeto(await ref.get()), req.usuario));
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
