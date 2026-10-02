// Consultas de honorarios compartidas por la API, el dashboard y la exportación.
const { db, aObjeto } = require('../db');
const { hoy, mapaClientes } = require('../util');
const { plano } = require('./clientes');

const honorarios = () => db.collection('honorarios');
const redondear = (n) => Math.round(n * 100) / 100;
const mesActual = () => hoy().slice(0, 7);
const LIMITE = 2000;

// Estado de cobro y si está vencido (saldo pendiente de un mes que ya terminó).
function conEstado(h, clientes) {
  return {
    ...h,
    clienteNombre: clientes.get(h.clienteId) ?? '(cliente eliminado)',
    estado: h.saldo <= 0 ? 'PAGADO' : h.pagado > 0 ? 'PARCIAL' : 'PENDIENTE',
    vencido: h.saldo > 0 && h.periodo < mesActual(),
  };
}

const totales = (lista) => ({
  monto: redondear(lista.reduce((t, h) => t + h.monto, 0)),
  pagado: redondear(lista.reduce((t, h) => t + h.pagado, 0)),
  saldo: redondear(lista.reduce((t, h) => t + h.saldo, 0)),
});

// `ids` = clientes que puede ver quien consulta (null = todos)
// { periodo | clienteId | (nada = todo lo adeudado), estado, q } -> { totales, datos }
async function consultar({ periodo, clienteId, estado, q } = {}, ids = null) {
  let consulta = honorarios();
  if (clienteId) consulta = consulta.where('clienteId', '==', String(clienteId));
  else if (periodo) consulta = consulta.where('periodo', '==', String(periodo));
  else consulta = consulta.where('saldo', '>', 0).limit(LIMITE);

  const [snap, clientes] = await Promise.all([consulta.get(), mapaClientes()]);
  let lista = snap.docs.map(aObjeto).filter((h) => ids === null || ids.has(h.clienteId)).map((h) => conEstado(h, clientes));
  if (['PENDIENTE', 'PARCIAL', 'PAGADO'].includes(estado)) lista = lista.filter((h) => h.estado === estado);
  if (estado === 'DEUDA') lista = lista.filter((h) => h.saldo > 0);
  if (q) lista = lista.filter((h) => plano(h.clienteNombre).includes(plano(q)));
  lista.sort((a, b) => b.periodo.localeCompare(a.periodo) || a.clienteNombre.localeCompare(b.clienteNombre, 'es'));
  return { totales: totales(lista), datos: lista };
}

// Deuda por cliente (todos los períodos), de mayor a menor.
async function deudores(ids = null) {
  const [snap, clientes] = await Promise.all([honorarios().where('saldo', '>', 0).limit(LIMITE).get(), mapaClientes()]);
  const porCliente = new Map();
  for (const h of snap.docs.map(aObjeto).filter((x) => ids === null || ids.has(x.clienteId))) {
    const d = porCliente.get(h.clienteId) ?? { clienteId: h.clienteId, clienteNombre: clientes.get(h.clienteId) ?? '(cliente eliminado)', saldo: 0, cantidad: 0, masAntiguo: h.periodo };
    d.saldo = redondear(d.saldo + h.saldo);
    d.cantidad++;
    if (h.periodo < d.masAntiguo) d.masAntiguo = h.periodo;
    porCliente.set(h.clienteId, d);
  }
  const lista = [...porCliente.values()].sort((a, b) => b.saldo - a.saldo);
  return { total: redondear(lista.reduce((t, d) => t + d.saldo, 0)), datos: lista };
}

module.exports = { honorarios, consultar, deudores, conEstado, redondear, mesActual };
