// Qué clientes ve cada persona y las guardas que usan las rutas.
// Regla: quien ve todos los clientes (administradores y usuarios con acceso "TODOS") no tiene límites; quien
// está limitado solo ve los clientes donde figura en `responsables`. Un cliente que no puede ver se trata como
// si no existiera (404), para no revelar ni siquiera que existe.
const { db, aObjeto } = require('../db');
const { todosLosClientes } = require('../cache');
const { veTodosLosClientes } = require('../permisos');

// `usuario` = { id, todosLosClientes }  (el de la sesión) — o un documento de usuario crudo, ver `comoAcceso`.
const comoAcceso = (doc) => ({ id: doc.id, todosLosClientes: veTodosLosClientes(doc) });

async function clientesVisibles(usuario) {
  const todos = await todosLosClientes();
  return usuario.todosLosClientes ? todos : todos.filter((c) => (c.responsables || []).includes(usuario.id));
}

// null = sin límite (ve todos); si no, el conjunto de ids de clientes que puede ver
async function idsVisibles(usuario) {
  if (usuario.todosLosClientes) return null;
  return new Set((await clientesVisibles(usuario)).map((c) => c.id));
}

async function puedeVerCliente(usuario, clienteId) {
  if (usuario.todosLosClientes) return true;
  const c = (await todosLosClientes()).find((x) => x.id === clienteId);
  return Boolean(c && (c.responsables || []).includes(usuario.id));
}

// Una tarea/vencimiento/honorario sin cliente (ej. tarea interna) lo ve cualquiera; con cliente, solo quien ve ese cliente.
const visiblePara = (ids, clienteId) => ids === null || !clienteId || ids.has(clienteId);

// Guarda para rutas con :id de cliente. Responde 404 y devuelve false si no tiene acceso.
async function exigirCliente(req, res, clienteId) {
  if (!clienteId || (await puedeVerCliente(req.usuario, clienteId))) return true;
  res.status(404).json({ error: 'Cliente no encontrado' });
  return false;
}

// Vencimientos pendientes (con `alerta` <= limite) de un conjunto de clientes. Consulta por cliente (campo único,
// sin índices compuestos) y filtra en memoria; quien está limitado tiene pocos clientes.
async function vencimientosPendientes(ids, limite) {
  const lista = [...ids];
  const trozos = [];
  for (let i = 0; i < lista.length; i += 30) trozos.push(lista.slice(i, i + 30));
  const snaps = await Promise.all(trozos.map((t) => db.collection('vencimientos').where('clienteId', 'in', t).get()));
  return snaps.flatMap((s) => s.docs.map(aObjeto)).filter((v) => v.alerta && v.alerta <= limite);
}

module.exports = { vencimientosPendientes, comoAcceso, clientesVisibles, idsVisibles, puedeVerCliente, visiblePara, exigirCliente };
