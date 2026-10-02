// Resumen de pendientes urgentes. Es la consulta más repetida del sistema (se refresca cada pocos
// minutos por usuario), así que NO lee los pendientes uno por uno:
//  - vencimientos: 3 consultas de conteo (cuestan ~1 lectura cada una, sin importar cuántos haya)
//    Quien ve solo algunos clientes los cuenta sobre sus propios clientes (son pocos).
//  - tareas: solo las pendientes del usuario hasta dentro de 7 días (son pocas)
const { db, aObjeto } = require('../db');
const { hoy, sumarDias, situacion, DIAS_ALERTA } = require('../util');
const { idsVisibles, visiblePara, vencimientosPendientes } = require('./acceso');

async function contarVencimientos(ids, h, limite) {
  if (ids === null) {
    const venc = db.collection('vencimientos');
    const contar = async (q) => (await q.count().get()).data().count;
    const [vencidos, deHoy, proximos] = await Promise.all([
      contar(venc.where('alerta', '<', h)),
      contar(venc.where('alerta', '==', h)),
      contar(venc.where('alerta', '>', h).where('alerta', '<=', limite)),
    ]);
    return { vencidos, hoy: deHoy, proximos };
  }
  const l = await vencimientosPendientes(ids, limite);
  return { vencidos: l.filter((v) => v.alerta < h).length, hoy: l.filter((v) => v.alerta === h).length, proximos: l.filter((v) => v.alerta > h).length };
}

// `usuario` = el de la sesión ({ id, todosLosClientes })
async function resumenAlertas(usuario) {
  const h = hoy();
  const limite = sumarDias(h, DIAS_ALERTA);
  const ids = await idsVisibles(usuario);

  const [tareasSnap, venc] = await Promise.all([
    db.collection('tareas').where('alertaDe', '>=', `${usuario.id}|`).where('alertaDe', '<=', `${usuario.id}|${limite}`).get(),
    contarVencimientos(ids, h, limite),
  ]);

  const estados = tareasSnap.docs.map(aObjeto).filter((t) => visiblePara(ids, t.clienteId)).map((t) => situacion(t.vence, false));
  const cuenta = (s) => estados.filter((x) => x === s).length;
  const tareas = { vencidas: cuenta('VENCIDA'), hoy: cuenta('HOY'), proximas: cuenta('PROXIMA') };
  return {
    tareas,
    vencimientos: venc,
    // Lo que requiere atención ya: vencido o con vencimiento hoy
    urgentes: tareas.vencidas + tareas.hoy + venc.vencidos + venc.hoy,
  };
}

module.exports = { resumenAlertas };
