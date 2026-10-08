// Recibo por email cuando un cliente paga. Es un comprobante "de cortesía": nunca hace fallar el cobro, y cada recibo
// se envía una sola vez (se reserva en `envios/recibo_{pagoId}`), salvo que se pida reenviarlo a propósito.
const { z } = require('zod');
const { db } = require('../db');
const correo = require('../correo/transporte');
const P = require('../correo/plantillas');

const email = z.string().email();
const ESPERA_MAX_MS = 8000;

// Devuelve: 'enviado' | 'ya-enviado' | 'sin-email' | 'desactivado' | 'sin-correo' | 'error'
async function enviarRecibo({ pago, honorario, cliente, reenviar = false }) {
  if (!cliente || !email.safeParse(cliente.email).success) return 'sin-email';
  if (cliente.recordatorios === false) return 'desactivado'; // pidió no recibir avisos
  if (!correo.configurado()) return 'sin-correo';

  const clave = reenviar ? `recibo_${pago.id}_${Date.now()}` : `recibo_${pago.id}`;
  const ref = db.collection('envios').doc(clave);
  const registro = { clave, tipo: 'recibo', to: cliente.email, destino: cliente.razonSocial, fecha: pago.fecha, creadoEn: new Date() };
  const m = P.recibo({
    cliente: cliente.razonSocial, estudio: correo.estudio(), numero: pago.numero, fecha: pago.fecha, concepto: honorario.concepto,
    periodo: honorario.periodo, monto: pago.monto, medio: pago.medio, nota: pago.nota, saldo: honorario.saldo,
  });
  registro.asunto = m.subject;

  const envio = (async () => {
    const reservado = await db.runTransaction(async (tx) => {
      const d = await tx.get(ref);
      if (d.exists && d.data().ok === true) return false;
      tx.set(ref, { ...registro, estado: 'enviando', ok: null, error: null });
      return true;
    });
    if (!reservado) return 'ya-enviado';
    try {
      await correo.enviar({ to: cliente.email, subject: m.subject, html: m.html, text: m.text });
      await ref.update({ estado: 'enviado', ok: true, enviadoEn: new Date() });
      await db.collection('pagos').doc(pago.id).update({ reciboEnviadoEn: new Date(), reciboEnviadoA: cliente.email }).catch(() => {});
      return 'enviado';
    } catch (e) {
      console.error('[recibo] no se pudo enviar:', e.message);
      await ref.update({ estado: 'error', ok: false, error: String(e.message).slice(0, 200) }).catch(() => {});
      return 'error';
    }
  })();
  return Promise.race([envio, new Promise((r) => setTimeout(() => r('error'), ESPERA_MAX_MS))]);
}

module.exports = { enviarRecibo };
