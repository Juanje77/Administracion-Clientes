// Sueldos del equipo: cada persona cobra un % de lo que se cobró en el mes de los clientes que tiene asignados.
// Si un cliente tiene varias personas asignadas, lo cobrado se reparte en partes iguales entre ellas (así nada se cuenta
// dos veces). Lo cobrado de clientes sin nadie asignado queda para el estudio. Ganancia = cobrado - sueldos.
const { db, aObjeto } = require('../db');
const { todosLosClientes } = require('../cache');
const { redondear } = require('./honorarios');

const sueldoPagos = () => db.collection('sueldoPagos');

async function calcular(periodo) {
  const [pagosSnap, equipoSnap, sueldosSnap, clientes] = await Promise.all([
    db.collection('pagos').where('fecha', '>=', `${periodo}-01`).where('fecha', '<=', `${periodo}-31`).get(),
    db.collection('usuarios').where('activo', '==', true).get(),
    sueldoPagos().where('periodo', '==', periodo).get(),
    todosLosClientes(),
  ]);
  const responsables = new Map(clientes.map((c) => [c.id, (c.responsables || [])]));
  const equipo = equipoSnap.docs.map(aObjeto).filter((u) => u.rol !== 'ADMIN');
  const ids = new Set(equipo.map((u) => u.id));

  const pagosMes = pagosSnap.docs.map(aObjeto);
  // concepto de cada cobro (para mostrar de qué es)
  const honIds = [...new Set(pagosMes.map((p) => p.honorarioId).filter(Boolean))];
  const honDocs = honIds.length ? await db.getAll(...honIds.map((id) => db.collection('honorarios').doc(id))) : [];
  const honorarios = new Map(honDocs.filter((d) => d.exists).map((d) => [d.id, d.data()]));
  const nombreCliente = new Map(clientes.map((c) => [c.id, c.razonSocial]));
  const nombreUsuario = new Map(equipo.map((u) => [u.id, u.nombre]));

  const base = new Map(); // usuarioId -> cobrado de sus clientes
  let cobrado = 0;
  let sinAsignar = 0;
  const cobros = [];
  for (const p of pagosMes) {
    cobrado += p.monto;
    const dueños = (responsables.get(p.clienteId) || []).filter((id) => ids.has(id));
    if (!dueños.length) sinAsignar += p.monto;
    for (const id of dueños) base.set(id, (base.get(id) || 0) + p.monto / dueños.length);
    const h = honorarios.get(p.honorarioId);
    cobros.push({
      id: p.id, fecha: p.fecha, monto: p.monto, medio: p.medio, clienteId: p.clienteId,
      cliente: nombreCliente.get(p.clienteId) ?? '(cliente eliminado)', concepto: h ? `${h.concepto} · ${h.periodo}` : null,
      asignadoA: dueños.map((id) => ({ id, nombre: nombreUsuario.get(id) })), // vacío = del titular
    });
  }
  cobros.sort((a, b) => b.fecha.localeCompare(a.fecha) || a.cliente.localeCompare(b.cliente, 'es'));

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
      cobrado, sinAsignar: redondear(sinAsignar), sueldos, pagado, pendiente: redondear(sueldos - pagado),
      ganancia: redondear(cobrado - sueldos), // con lo que corresponde pagar
      gananciaReal: redondear(cobrado - pagado), // con lo efectivamente pagado hasta ahora
    },
    filas,
    cobros, // de qué se compone el cobrado del mes
  };
}

module.exports = { calcular, sueldoPagos };
