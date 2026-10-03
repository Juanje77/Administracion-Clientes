// Genera los vencimientos de los clientes a partir de los calendarios impositivos cargados.
// Cada cliente ACTIVO con obligaciones marcadas recibe un vencimiento por obligación, con la fecha que
// le corresponde según el último dígito de su CUIT.
const { db } = require('../db');
const { alertaVencimiento, hoy } = require('../util');

const slug = (t) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// `desde`: no se crean vencimientos con fecha anterior (al dar de alta un cliente no tiene sentido llenar la Agenda de vencidos).
async function aplicarFilas(periodo, filas, todos, { desde = null } = {}) {
  const clientes = todos.filter((c) => c.estado === 'ACTIVO' && (c.obligaciones || []).length);
  const sinCuit = new Set();
  const sinFecha = new Set();
  const previstos = [];
  for (const c of clientes) {
    const digitos = String(c.cuit || '').replace(/\D/g, '');
    for (const fila of filas.filter((f) => c.obligaciones.includes(f.clave))) {
      if (digitos.length !== 11) { sinCuit.add(c.razonSocial); continue; }
      const vence = fila.fechas[digitos[10]];
      if (!vence) { sinFecha.add(`${c.razonSocial} – ${fila.titulo}`); continue; }
      if (desde && vence < desde) continue;
      previstos.push({
        id: `${c.id}_${slug(fila.clave)}_${periodo}`,
        datos: { clienteId: c.id, impuesto: [fila.obligacion, fila.concepto].filter(Boolean).join(' – '), periodo, vence, notas: null, origen: 'calendario', clave: fila.clave },
      });
    }
  }

  const refs = previstos.map((p) => db.collection('vencimientos').doc(p.id));
  const existentes = refs.length ? await db.getAll(...refs) : [];
  let creados = 0, actualizados = 0, sinCambios = 0;
  for (let i = 0; i < previstos.length; i += 400) {
    const lote = db.batch();
    previstos.slice(i, i + 400).forEach((p, j) => {
      const previo = existentes[i + j];
      if (!previo.exists) {
        lote.create(refs[i + j], { ...p.datos, estado: 'PENDIENTE', presentadoEn: null, creadoEn: new Date(), ...alertaVencimiento({ ...p.datos, estado: 'PENDIENTE' }) });
        creados++;
      } else if (previo.data().estado === 'PENDIENTE' && previo.data().vence !== p.datos.vence) {
        lote.update(refs[i + j], { vence: p.datos.vence, impuesto: p.datos.impuesto, avisadoEn: null, ...alertaVencimiento({ vence: p.datos.vence, estado: 'PENDIENTE' }) }); // fecha nueva: se vuelve a avisar
        actualizados++;
      } else sinCambios++;
    });
    await lote.commit();
  }
  return { clientes: clientes.length, creados, actualizados, sinCambios, sinCuit: [...sinCuit], sinFecha: [...sinFecha] };
}

// Al crear o editar un cliente: sus obligaciones pasan a la Agenda según todos los calendarios cargados.
async function sincronizarCliente(cliente) {
  const snap = await db.collection('calendarios').get();
  const total = { creados: 0, actualizados: 0, sinCuit: false, sinFecha: [] };
  for (const d of snap.docs) {
    const r = await aplicarFilas(d.id, d.data().filas, [cliente], { desde: hoy() });
    total.creados += r.creados;
    total.actualizados += r.actualizados;
    if (r.sinCuit.length) total.sinCuit = true;
    total.sinFecha.push(...r.sinFecha);
  }
  return total;
}

module.exports = { aplicarFilas, sincronizarCliente };
