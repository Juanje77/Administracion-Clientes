// Totales mensuales precalculados para el Inicio: resumenes/{AAAA-MM} = { facturado, cobrado }.
//
// Se mantienen solos: cada vez que se crea, cambia o borra un honorario o un cobro se suma/resta la
// diferencia en el mismo lote o transacción (FieldValue.increment, atómico). Así el Inicio lee 6
// documentos pequeños y no hace consultas de suma sobre toda la colección (que en Firestore real
// exigen índices compuestos y cuestan lecturas). `recalcular()` reconstruye todo desde cero.
const { FieldValue } = require('firebase-admin/firestore');
const { db, aObjeto } = require('../db');

const resumenes = () => db.collection('resumenes');
const redondear = (n) => Math.round(n * 100) / 100;

// `op` puede ser un batch o una transacción: ambos tienen .set(ref, datos, { merge })
function sumarFacturado(op, periodo, delta) {
  if (!delta) return;
  op.set(resumenes().doc(periodo), { facturado: FieldValue.increment(redondear(delta)), actualizadoEn: new Date() }, { merge: true });
}
// El cobrado se cuenta en el mes de la FECHA del cobro (no del período del honorario).
function sumarCobrado(op, fecha, delta) {
  if (!delta) return;
  op.set(resumenes().doc(fecha.slice(0, 7)), { cobrado: FieldValue.increment(redondear(delta)), actualizadoEn: new Date() }, { merge: true });
}

async function leerSerie(periodos) {
  const docs = await db.getAll(...periodos.map((p) => resumenes().doc(p)));
  return docs.map((d, i) => {
    const x = d.exists ? d.data() : {};
    return { periodo: periodos[i], facturado: Math.max(0, redondear(x.facturado ?? 0)), cobrado: Math.max(0, redondear(x.cobrado ?? 0)) };
  });
}

// Reconstruye todos los totales leyendo honorarios y cobros. Es seguro repetirlo.
async function recalcular() {
  const [hon, pag, viejos] = await Promise.all([db.collection('honorarios').get(), db.collection('pagos').get(), resumenes().get()]);
  const totales = new Map();
  const dato = (p) => { if (!totales.has(p)) totales.set(p, { facturado: 0, cobrado: 0 }); return totales.get(p); };
  for (const h of hon.docs.map(aObjeto)) dato(h.periodo).facturado += h.monto;
  for (const p of pag.docs.map(aObjeto)) dato(p.fecha.slice(0, 7)).cobrado += p.monto;

  const escrituras = [
    ...viejos.docs.filter((d) => d.id !== '_estado').map((d) => (b) => b.delete(d.ref)),
    ...[...totales].map(([p, t]) => (b) => b.set(resumenes().doc(p), { facturado: redondear(t.facturado), cobrado: redondear(t.cobrado), actualizadoEn: new Date() })),
    (b) => b.set(resumenes().doc('_estado'), { recalculadoEn: new Date() }),
  ];
  for (let i = 0; i < escrituras.length; i += 400) {
    const lote = db.batch();
    escrituras.slice(i, i + 400).forEach((e) => e(lote));
    await lote.commit();
  }
  return { periodos: totales.size, honorarios: hon.size, cobros: pag.size };
}

// La primera vez (o tras una actualización del sistema) arma los totales con lo que ya existe.
async function asegurarResumenes() {
  if (!(await resumenes().doc('_estado').get()).exists) await recalcular();
}

// Borra honorarios con sus cobros y descuenta sus montos de los totales.
async function borrarHonorarios(docs) {
  for (const h of docs) {
    const cobros = await db.collection('pagos').where('honorarioId', '==', h.id).get();
    const lote = db.batch();
    sumarFacturado(lote, h.data().periodo, -h.data().monto);
    for (const c of cobros.docs) { sumarCobrado(lote, c.data().fecha, -c.data().monto); lote.delete(c.ref); }
    lote.delete(h.ref);
    await lote.commit();
  }
}

module.exports = { sumarFacturado, sumarCobrado, leerSerie, recalcular, asegurarResumenes, borrarHonorarios };
