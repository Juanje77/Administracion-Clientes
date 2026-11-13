// Estado actual del estudio (solo administradores): resultado del mes, antigüedad de la deuda, carga de trabajo del equipo,
// vencimientos y datos que faltan completar. Todo sale de datos que el sistema ya guarda.
const { db, aObjeto } = require('../db');
const { todosLosClientes } = require('../cache');
const { hoy, sumarDias, situacion } = require('../util');
const { redondear, mesActual } = require('./honorarios');
const { calcular } = require('./sueldos');
const { resumenAlertas } = require('./alertas');

const LIMITE = 2000;
const mesesEntre = (desde, hasta) => (Number(hasta.slice(0, 4)) - Number(desde.slice(0, 4))) * 12 + Number(hasta.slice(5, 7)) - Number(desde.slice(5, 7));

// Hasta 8 ejemplos (para poder ir a corregirlos) y el total
const muestra = (lista) => ({ cantidad: lista.length, ejemplos: lista.slice(0, 8).map((c) => ({ id: c.id, nombre: c.razonSocial })) });

async function estadoEstudio(periodo = mesActual(), usuario) {
  const [sueldos, clientes, deudaSnap, tareasSnap, usuariosSnap, agenda] = await Promise.all([
    calcular(periodo),
    todosLosClientes(),
    db.collection('honorarios').where('saldo', '>', 0).limit(LIMITE).get(),
    db.collection('tareas').where('alerta', '<=', '9999-12-31').limit(LIMITE).get(),
    db.collection('usuarios').where('activo', '==', true).get(),
    resumenAlertas({ id: usuario.id, todosLosClientes: true }),
  ]);
  const t = sueldos.totales;
  const h = hoy();

  // ---- Resultado del período (devengado) ----
  const resultado = {
    facturado: t.facturado, cobrado: t.cobrado, falta: t.falta,
    cobranza: t.facturado > 0 ? Math.round((t.cobrado / t.facturado) * 100) : null, // % de lo facturado ya cobrado
    sueldos: t.sueldos, sueldosPagados: t.pagado, ganancia: t.ganancia, gananciaReal: t.gananciaReal,
  };

  // ---- Deuda por antigüedad (según el período del honorario) ----
  const tramos = [
    { clave: 'mes', nombre: 'Del mes actual', saldo: 0, cantidad: 0 },
    { clave: '1', nombre: '1 mes de atraso', saldo: 0, cantidad: 0 },
    { clave: '2', nombre: '2 meses de atraso', saldo: 0, cantidad: 0 },
    { clave: '3', nombre: '3 meses o más', saldo: 0, cantidad: 0 },
  ];
  for (const x of deudaSnap.docs.map(aObjeto)) {
    const atraso = Math.max(0, mesesEntre(x.periodo, mesActual()));
    const tr = tramos[Math.min(atraso, 3)];
    tr.saldo = redondear(tr.saldo + x.saldo);
    tr.cantidad += 1;
  }
  const deuda = { total: redondear(tramos.reduce((s, x) => s + x.saldo, 0)), tramos };

  // ---- Equipo: carga de trabajo, cartera y sueldo ----
  const tareas = tareasSnap.docs.map(aObjeto);
  const porPersona = (id) => {
    const mias = tareas.filter((x) => x.asignadoA === id);
    const est = mias.map((x) => situacion(x.vence, false));
    return { pendientes: mias.length, vencidas: est.filter((e) => e === 'VENCIDA').length, hoy: est.filter((e) => e === 'HOY').length };
  };
  const sueldoDe = new Map(sueldos.filas.map((f) => [f.usuarioId, f]));
  const activos = clientes.filter((c) => c.estado === 'ACTIVO');
  const equipo = usuariosSnap.docs.map(aObjeto).map((u) => {
    const s = sueldoDe.get(u.id);
    return {
      id: u.id, nombre: u.nombre, admin: u.rol === 'ADMIN',
      clientes: u.rol === 'ADMIN' ? activos.filter((c) => !(c.responsables || []).length).length : activos.filter((c) => (c.responsables || []).includes(u.id)).length,
      ...porPersona(u.id),
      cobrado: s ? s.base : null, sueldo: s ? s.corresponde : null, // el titular no cobra sueldo
    };
  }).sort((a, b) => b.admin - a.admin || a.nombre.localeCompare(b.nombre, 'es'));
  const sinDueño = tareas.filter((x) => !x.asignadoA).length;

  // ---- Vencimientos impositivos ----
  const vencimientos = { ...agenda.vencimientos }; // vencidos | hoy | proximos (7 días)

  // ---- Para completar ----
  const hoyMes = h.slice(0, 7);
  const faltan = {
    sinEmail: muestra(activos.filter((c) => !c.email)),
    sinCuit: muestra(activos.filter((c) => !c.cuit)),
    sinObligaciones: muestra(activos.filter((c) => !(c.obligaciones || []).length)),
    sinAbono: muestra(activos.filter((c) => !(c.abonoMensual > 0))),
    sociedadesSinCierre: muestra(activos.filter((c) => c.tipoPersona === 'JURIDICA' && !c.cierreMes)),
  };
  const cartera = {
    total: clientes.length, activos: activos.length,
    potenciales: clientes.filter((c) => c.estado === 'POTENCIAL').length,
    inactivos: clientes.filter((c) => c.estado === 'INACTIVO').length,
    nuevosMes: clientes.filter((c) => c.creadoEn && c.creadoEn.toISOString().slice(0, 7) === hoyMes).length,
  };

  return { periodo, resultado, deuda, equipo, tareasSinResponsable: sinDueño, vencimientos, cartera, faltan, tareasPendientes: tareas.length };
}

module.exports = { estadoEstudio };
