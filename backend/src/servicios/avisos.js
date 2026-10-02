// Avisos por email: resumen diario al equipo y recordatorios a clientes.
//
// Resguardos (porque parte de esto sale hacia clientes reales):
//  - Los recordatorios a clientes están APAGADOS hasta que un administrador los active.
//  - Hay vista previa (planificar) que no envía nada.
//  - Cada envío se "reclama" en la colección `envios` antes de mandarse: si el proceso corre dos veces
//    (reintento del cron, doble clic) no se duplica. La deuda además respeta una pausa entre avisos
//    por cliente y cada vencimiento se avisa una sola vez.
//  - Solo reciben avisos clientes ACTIVOS, con email válido y sin el recordatorio desactivado.
const { z } = require('zod');
const { db, aObjeto, errorConfig } = require('../db');
const { todosLosClientes } = require('../cache');
const { hoy: hoyReal, sumarDias } = require('../util');
const { deudores: calcularDeudores } = require('./honorarios');
const correo = require('../correo/transporte');
const P = require('../correo/plantillas');

const CONFIG_POR_DEFECTO = {
  equipoActivo: true,
  clientesDeuda: false,
  clientesVencimientos: false,
  diasEntreAvisosDeuda: 15,
  diasAnticipoVencimiento: 3,
  textoPago: '',
};
const email = z.string().email();
const MAX_GRUPOS = 15;

async function leerConfig() {
  const doc = await db.collection('config').doc('avisos').get();
  return { ...CONFIG_POR_DEFECTO, ...(doc.exists ? doc.data() : {}) };
}
async function guardarConfig(c) {
  await db.collection('config').doc('avisos').set(c);
  return c;
}

const dias = (desde, hasta) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);

// "IVA – DDJJ · vence 19/10: Ana, Beto, Cris y 22 más"
function agruparVencimientos(lista, nombres, h, verbo) {
  const grupos = new Map();
  for (const v of lista) {
    const k = `${v.impuesto}|${v.vence}`;
    if (!grupos.has(k)) grupos.set(k, { impuesto: v.impuesto, vence: v.vence, clientes: [] });
    grupos.get(k).clientes.push(nombres.get(v.clienteId) ?? '(cliente eliminado)');
  }
  const ordenados = [...grupos.values()].sort((a, b) => a.vence.localeCompare(b.vence) || a.impuesto.localeCompare(b.impuesto, 'es'));
  const filas = ordenados.slice(0, MAX_GRUPOS).map((g) => {
    const visibles = g.clientes.slice(0, 4).join(', ');
    const resto = g.clientes.length - 4;
    return { texto: `${g.impuesto} · ${verbo(g.vence, h)} ${P.fecha(g.vence)}: ${g.clientes.length === 1 ? visibles : `${g.clientes.length} clientes (${visibles}${resto > 0 ? ` y ${resto} más` : ''})`}` };
  });
  if (ordenados.length > MAX_GRUPOS) filas.push({ texto: `… y ${ordenados.length - MAX_GRUPOS} grupos más (ver la agenda)` });
  return filas;
}

// Arma TODOS los mensajes que corresponde enviar hoy, sin enviar nada.
async function planificar({ hoy: h = hoyReal() } = {}) {
  const cfg = await leerConfig();
  const url = (process.env.APP_URL || '').replace(/\/$/, '');
  const estudio = correo.estudio();
  const mensajes = [];
  const limite7 = sumarDias(h, 7);

  const [usuarios, tareasSnap, vencSnap, clientes] = await Promise.all([
    db.collection('usuarios').where('activo', '==', true).get(),
    db.collection('tareas').where('alerta', '<=', limite7).get(),
    db.collection('vencimientos').where('alerta', '<=', sumarDias(h, Math.max(7, cfg.diasAnticipoVencimiento))).get(),
    todosLosClientes(),
  ]);
  const nombres = new Map(clientes.map((c) => [c.id, c.razonSocial]));
  const tareas = tareasSnap.docs.map(aObjeto);
  const venc = vencSnap.docs.map(aObjeto);

  // ---------- Resumen para cada integrante del equipo ----------
  if (cfg.equipoActivo) {
    const vencimientos = {
      vencidos: agruparVencimientos(venc.filter((v) => v.vence < h), nombres, h, () => 'venció el'),
      hoy: agruparVencimientos(venc.filter((v) => v.vence === h), nombres, h, () => 'vence'),
      proximos: agruparVencimientos(venc.filter((v) => v.vence > h && v.vence <= limite7), nombres, h, () => 'vence el'),
    };
    const cuentaVenc = { vencidos: venc.filter((v) => v.vence < h).length, hoy: venc.filter((v) => v.vence === h).length };
    let deuda = null;
    for (const u of usuarios.docs.map(aObjeto)) {
      if (u.avisos === false || !email.safeParse(u.email).success) continue;
      const mias = tareas.filter((t) => t.asignadoA === u.id).map((t) => ({ ...t, clienteNombre: t.clienteId ? nombres.get(t.clienteId) ?? '(cliente eliminado)' : 'Tarea interna' }));
      const t = {
        vencidas: mias.filter((x) => x.vence < h),
        hoy: mias.filter((x) => x.vence === h),
        proximas: mias.filter((x) => x.vence > h && x.vence <= limite7),
      };
      let deudores;
      if (u.rol === 'ADMIN') {
        deuda ??= await calcularDeudores();
        if (deuda.datos.length) deudores = { total: deuda.total, top: deuda.datos.slice(0, 10) };
      }
      const hayAlgo = t.vencidas.length + t.hoy.length + t.proximas.length + vencimientos.vencidos.length + vencimientos.hoy.length + vencimientos.proximos.length > 0 || deudores;
      if (!hayAlgo) continue;
      const urgentes = t.vencidas.length + t.hoy.length + cuentaVenc.vencidos + cuentaVenc.hoy;
      const cuerpo = P.resumenEquipo({ nombre: u.nombre, estudio, url, tareas: t, vencimientos, deudores });
      mensajes.push({
        tipo: 'equipo', clave: `equipo_${u.id}_${h}`, to: u.email, destino: u.nombre,
        subject: `Resumen del día - ${estudio}${urgentes ? ` (${urgentes} ${urgentes === 1 ? 'urgente' : 'urgentes'})` : ''}`,
        detalle: `${t.vencidas.length + t.hoy.length} tareas urgentes, ${cuentaVenc.vencidos + cuentaVenc.hoy} vencimientos urgentes${deudores ? `, deuda ${P.pesos(deudores.total)}` : ''}`,
        ...cuerpo,
      });
    }
  }

  // ---------- Recordatorios a clientes ----------
  const aptos = clientes.filter((c) => c.estado === 'ACTIVO' && c.recordatorios !== false && email.safeParse(c.email).success);
  const aptoPorId = new Map(aptos.map((c) => [c.id, c]));

  if (cfg.clientesDeuda && aptos.length) {
    const snap = await db.collection('honorarios').where('saldo', '>', 0).limit(2000).get();
    const mesActual = h.slice(0, 7);
    const porCliente = new Map();
    for (const hon of snap.docs.map(aObjeto)) {
      if (hon.periodo >= mesActual || !aptoPorId.has(hon.clienteId)) continue; // solo lo atrasado
      porCliente.set(hon.clienteId, [...(porCliente.get(hon.clienteId) ?? []), hon]);
    }
    const ids = [...porCliente.keys()];
    const previos = ids.length ? await db.getAll(...ids.map((id) => db.collection('avisosCliente').doc(id))) : [];
    ids.forEach((id, i) => {
      const ultimo = previos[i].exists ? previos[i].data().ultimoAvisoDeuda : null;
      if (ultimo && dias(ultimo, h) < cfg.diasEntreAvisosDeuda) return;
      const c = aptoPorId.get(id);
      const items = porCliente.get(id).sort((a, b) => a.periodo.localeCompare(b.periodo));
      const total = Math.round(items.reduce((s, x) => s + x.saldo, 0) * 100) / 100;
      const m = P.recordatorioDeuda({ cliente: c.razonSocial, estudio, items, total, textoPago: cfg.textoPago });
      mensajes.push({
        tipo: 'cliente-deuda', clave: `deuda_${id}_${h}`, to: c.email, destino: c.razonSocial, subject: m.subject, html: m.html, text: m.text,
        detalle: `deuda ${P.pesos(total)} (${items.length} ${items.length === 1 ? 'período' : 'períodos'})`,
        despues: () => db.collection('avisosCliente').doc(id).set({ ultimoAvisoDeuda: h }, { merge: true }),
      });
    });
  }

  if (cfg.clientesVencimientos && aptos.length) {
    const porCliente = new Map();
    for (const v of venc) {
      if (v.avisadoEn || v.vence < h || v.vence > sumarDias(h, cfg.diasAnticipoVencimiento) || !aptoPorId.has(v.clienteId)) continue;
      porCliente.set(v.clienteId, [...(porCliente.get(v.clienteId) ?? []), v]);
    }
    for (const [id, lista] of porCliente) {
      const c = aptoPorId.get(id);
      const items = lista.sort((a, b) => a.vence.localeCompare(b.vence)).map((v) => ({ impuesto: v.impuesto, vence: v.vence, dias: dias(h, v.vence) }));
      const m = P.recordatorioVencimientos({ cliente: c.razonSocial, estudio, items });
      mensajes.push({
        tipo: 'cliente-vencimientos', clave: `venc_${id}_${h}`, to: c.email, destino: c.razonSocial, subject: m.subject, html: m.html, text: m.text,
        detalle: `${items.length} ${items.length === 1 ? 'vencimiento' : 'vencimientos'}`,
        despues: async () => {
          const lote = db.batch();
          for (const v of lista) lote.update(db.collection('vencimientos').doc(v.id), { avisadoEn: h });
          await lote.commit();
        },
      });
    }
  }
  return { hoy: h, config: cfg, mensajes };
}

const resumirPlan = (plan) => ({
  hoy: plan.hoy,
  total: plan.mensajes.length,
  porTipo: plan.mensajes.reduce((a, m) => ({ ...a, [m.tipo]: (a[m.tipo] ?? 0) + 1 }), {}),
  mensajes: plan.mensajes.map((m) => ({ tipo: m.tipo, destino: m.destino, to: m.to, asunto: m.subject, detalle: m.detalle })),
});

// Reserva el envío. Devuelve false si ya se envió (o se está enviando ahora mismo).
async function reclamar(m, h) {
  const ref = db.collection('envios').doc(m.clave);
  return db.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    const previo = d.exists ? d.data() : null;
    if (previo?.ok === true) return false;
    if (previo?.estado === 'enviando' && Date.now() - previo.creadoEn.toDate().getTime() < 5 * 60 * 1000) return false;
    tx.set(ref, { clave: m.clave, tipo: m.tipo, to: m.to, destino: m.destino, asunto: m.subject, fecha: h, estado: 'enviando', ok: null, error: null, intentos: (previo?.intentos ?? 0) + 1, creadoEn: new Date() });
    return true;
  });
}

// Envía (o simula) los avisos de hoy. `limiteMs` evita pasarse del tiempo máximo de la función:
// lo que quede sin enviar sale en la próxima ejecución (los envíos ya hechos no se repiten).
async function ejecutar({ hoy: h = hoyReal(), simular = false, limiteMs = 22000, concurrencia = 4 } = {}) {
  const plan = await planificar({ hoy: h });
  if (simular) return { simulacion: true, ...resumirPlan(plan) };
  if (plan.mensajes.length && !correo.configurado()) {
    throw errorConfig('El correo no está configurado: faltan las variables SMTP_USER y SMTP_PASS (ver README, sección Avisos por email)');
  }

  const inicio = Date.now();
  const resultado = { enviados: 0, yaEnviados: 0, pendientes: 0, errores: [] };
  const cola = [...plan.mensajes];
  const trabajador = async () => {
    for (let m = cola.shift(); m; m = cola.shift()) {
      if (Date.now() - inicio > limiteMs) { resultado.pendientes++; continue; }
      if (!(await reclamar(m, h))) { resultado.yaEnviados++; continue; }
      const ref = db.collection('envios').doc(m.clave);
      try {
        await correo.enviar({ to: m.to, subject: m.subject, html: m.html, text: m.text });
        await ref.update({ estado: 'enviado', ok: true, enviadoEn: new Date() });
        await m.despues?.();
        resultado.enviados++;
      } catch (e) {
        const motivo = String(e.message || e).slice(0, 200);
        await ref.update({ estado: 'error', ok: false, error: motivo }).catch(() => {});
        resultado.errores.push({ to: m.to, error: motivo });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrencia, cola.length) || 1 }, trabajador));
  return resultado;
}

async function enviarPrueba(a) {
  const m = P.prueba({ estudio: correo.estudio() });
  await correo.enviar({ to: a, ...m });
}

async function historial() {
  const snap = await db.collection('envios').orderBy('creadoEn', 'desc').limit(50).get();
  return snap.docs.map(aObjeto).map(({ id, tipo, to, destino, asunto, fecha, estado, error, creadoEn }) => ({ id, tipo, to, destino, asunto, fecha, estado, error, creadoEn }));
}

module.exports = { leerConfig, guardarConfig, planificar, ejecutar, enviarPrueba, historial, resumirPlan, CONFIG_POR_DEFECTO };
