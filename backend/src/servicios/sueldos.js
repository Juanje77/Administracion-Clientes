// Sueldos del equipo: cada persona cobra un % de lo cobrado de los honorarios del mes (devengado) de los clientes que tiene
// asignados. Cuenta el período del honorario, no la fecha del cobro: lo devengado en octubre que el cliente paga a
// principios de noviembre sigue siendo de octubre. Si un cliente tiene varias personas asignadas, lo cobrado se reparte en
// partes iguales (así nada se cuenta dos veces). Lo de clientes sin nadie asignado es del titular. Ganancia = cobrado - sueldos.
const { db, aObjeto } = require('../db');
const { todosLosClientes } = require('../cache');
const { redondear } = require('./honorarios');

const sueldoPagos = () => db.collection('sueldoPagos');

async function calcular(periodo) {
  const [honSnap, equipoSnap, sueldosSnap, clientes] = await Promise.all([
    db.collection('honorarios').where('periodo', '==', periodo).get(),
    db.collection('usuarios').where('activo', '==', true).get(),
    sueldoPagos().where('periodo', '==', periodo).get(),
    todosLosClientes(),
  ]);
  const honorarios = honSnap.docs.map(aObjeto);
  const responsables = new Map(clientes.map((c) => [c.id, (c.responsables || [])]));
  const nombreCliente = new Map(clientes.map((c) => [c.id, c.razonSocial]));
  const equipo = equipoSnap.docs.map(aObjeto).filter((u) => u.rol !== 'ADMIN');
  const ids = new Set(equipo.map((u) => u.id));
  const nombreUsuario = new Map(equipo.map((u) => [u.id, u.nombre]));

  // fechas de los cobros de esos honorarios (solo para mostrar cuándo se cobró cada uno)
  const fechas = new Map();
  const honIds = honorarios.map((h) => h.id);
  for (let i = 0; i < honIds.length; i += 30) {
    const snap = await db.collection('pagos').where('honorarioId', 'in', honIds.slice(i, i + 30)).get();
    for (const p of snap.docs.map(aObjeto)) fechas.set(p.honorarioId, [...(fechas.get(p.honorarioId) || []), { fecha: p.fecha, monto: p.monto }]);
  }

  const base = new Map(); // usuarioId -> cobrado de sus clientes
  let facturado = 0;
  let cobrado = 0;
  let sinAsignar = 0;
  const cobros = [];
  for (const h of honorarios) {
    facturado += h.monto;
    cobrado += h.pagado;
    const dueños = (responsables.get(h.clienteId) || []).filter((id) => ids.has(id));
    if (!dueños.length) sinAsignar += h.pagado;
    for (const id of dueños) base.set(id, (base.get(id) || 0) + h.pagado / dueños.length);
    cobros.push({
      id: h.id, clienteId: h.clienteId, cliente: nombreCliente.get(h.clienteId) ?? '(cliente eliminado)', concepto: h.concepto,
      facturado: h.monto, cobrado: h.pagado, saldo: h.saldo,
      cobradoEn: (fechas.get(h.id) || []).sort((a, b) => a.fecha.localeCompare(b.fecha)), // [{fecha, monto}]
      asignadoA: dueños.map((id) => ({ id, nombre: nombreUsuario.get(id) })), // vacío = del titular
    });
  }
  cobros.sort((a, b) => a.cliente.localeCompare(b.cliente, 'es'));

  const pagos = sueldosSnap.docs.map(aObjeto).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creadoEn - a.creadoEn);
  const filas = equipo.map((u) => {
    const b = redondear(base.get(u.id) || 0);
    const porcentaje = u.porcentajeSueldo ?? 0;
    const corresponde = redondear((b * porcentaje) / 100);
    const propios = pagos.filter((p) => p.usuarioId === u.id);
    const pagado = redondear(propios.reduce((t, p) => t + p.monto, 0));
    return { usuarioId: u.id, nombre: u.nombre, porcentaje, base: b, corresponde, pagado, pendiente: redondear(corresponde - pagado), pagos: propios };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const sueldos = redondear(filas.reduce((t, f) => t + f.corresponde, 0));
  const pagado = redondear(filas.reduce((t, f) => t + f.pagado, 0));
  cobrado = redondear(cobrado);
  return {
    periodo,
    totales: {
      facturado: redondear(facturado), cobrado, sinAsignar: redondear(sinAsignar), falta: redondear(facturado - cobrado), sueldos, pagado, pendiente: redondear(sueldos - pagado),
      ganancia: redondear(cobrado - sueldos), // con lo que corresponde pagar
      gananciaReal: redondear(cobrado - pagado), // con lo efectivamente pagado hasta ahora
    },
    filas,
    cobros, // honorarios del mes (devengado) y cuánto se cobró de cada uno
  };
}

module.exports = { calcular, sueldoPagos };
