// Resumen de pendientes urgentes. Es la consulta más repetida del sistema (se refresca cada pocos
// minutos por usuario), así que NO lee los pendientes uno por uno:
//  - vencimientos: 3 consultas de conteo (cuestan ~1 lectura cada una, sin importar cuántos haya)
//  - tareas: solo las pendientes del usuario hasta dentro de 7 días (son pocas)
const { db, aObjeto } = require('../db');
const { hoy, sumarDias, situacion, DIAS_ALERTA } = require('../util');

async function resumenAlertas(usuarioId) {
  const h = hoy();
  const limite = sumarDias(h, DIAS_ALERTA);
  const venc = db.collection('vencimientos');
  const contar = async (q) => (await q.count().get()).data().count;

  const [tareasSnap, vencidos, deHoy, proximos] = await Promise.all([
    db.collection('tareas').where('alertaDe', '>=', `${usuarioId}|`).where('alertaDe', '<=', `${usuarioId}|${limite}`).get(),
    contar(venc.where('alerta', '<', h)),
    contar(venc.where('alerta', '==', h)),
    contar(venc.where('alerta', '>', h).where('alerta', '<=', limite)),
  ]);

  const estados = tareasSnap.docs.map(aObjeto).map((t) => situacion(t.vence, false));
  const cuenta = (s) => estados.filter((x) => x === s).length;
  const tareas = { vencidas: cuenta('VENCIDA'), hoy: cuenta('HOY'), proximas: cuenta('PROXIMA') };
  return {
    tareas,
    vencimientos: { vencidos, hoy: deHoy, proximos },
    // Lo que requiere atención ya: vencido o con vencimiento hoy
    urgentes: tareas.vencidas + tareas.hoy + vencidos + deHoy,
  };
}

module.exports = { resumenAlertas };
