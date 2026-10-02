const router = require('express').Router();
const { db, aObjeto } = require('../db');
const { situacion, mapaClientes } = require('../util');

// Resumen para el aviso de la barra superior y la página Agenda.
// "mias" cuenta solo las tareas asignadas al usuario; los vencimientos son del estudio.
router.get('/', async (req, res) => {
  const [tareasSnap, vencSnap, clientes] = await Promise.all([
    db.collection('tareas').where('hecha', '==', false).get(),
    db.collection('vencimientos').where('estado', '==', 'PENDIENTE').get(),
    mapaClientes(),
  ]);
  const nombre = (x) => ({ ...x, clienteNombre: clientes.get(x.clienteId) ?? '(cliente eliminado)' });

  const tareas = tareasSnap.docs.map(aObjeto).filter((t) => t.asignadoA === req.usuario.id)
    .map((t) => nombre({ ...t, situacion: situacion(t.vence, false) }));
  const venc = vencSnap.docs.map(aObjeto).map((v) => nombre({ ...v, situacion: situacion(v.vence, false) }));

  const cuenta = (lista, s) => lista.filter((x) => x.situacion === s).length;
  res.json({
    tareas: { vencidas: cuenta(tareas, 'VENCIDA'), hoy: cuenta(tareas, 'HOY'), proximas: cuenta(tareas, 'PROXIMA') },
    vencimientos: { vencidos: cuenta(venc, 'VENCIDA'), hoy: cuenta(venc, 'HOY'), proximos: cuenta(venc, 'PROXIMA') },
    // Lo que requiere atención ya: vencido o con vencimiento hoy
    urgentes: [...tareas, ...venc].filter((x) => ['VENCIDA', 'HOY'].includes(x.situacion)).length,
  });
});

module.exports = router;
