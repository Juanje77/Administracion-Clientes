// Email a quien recibe una tarea (al crearla o al reasignarla). Es un aviso "de cortesía": nunca hace
// fallar la operación que lo origina, y se espera como máximo unos segundos (en un hosting serverless
// el trabajo posterior a la respuesta no está garantizado).
const { z } = require('zod');
const { db } = require('../db');
const correo = require('../correo/transporte');
const P = require('../correo/plantillas');

const email = z.string().email();
const ESPERA_MAX_MS = 8000;

// Devuelve: 'enviado' | 'desactivado' | 'sin-correo' | 'error' | null (si se la asignó a sí mismo)
async function avisarAsignacion({ tarea, asignado, actor, clienteNombre }) {
  if (!asignado || asignado.id === actor.id) return null;
  if (asignado.avisos === false) return 'desactivado';
  if (!correo.configurado() || !email.safeParse(asignado.email).success) return 'sin-correo';

  const m = P.tareaAsignada({
    nombre: asignado.nombre, quien: actor.nombre, titulo: tarea.titulo, cliente: clienteNombre, vence: tarea.vence,
    descripcion: tarea.descripcion, estudio: correo.estudio(), url: (process.env.APP_URL || '').replace(/\/$/, ''),
  });
  const ref = db.collection('envios').doc(`asig_${tarea.id}_${asignado.id}_${Date.now()}`);
  const registro = { tipo: 'tarea-asignada', to: asignado.email, destino: asignado.nombre, asunto: m.subject, fecha: tarea.vence, creadoEn: new Date() };
  const envio = (async () => {
    try {
      await correo.enviar({ to: asignado.email, subject: m.subject, html: m.html, text: m.text });
      await ref.set({ ...registro, estado: 'enviado', ok: true, error: null, enviadoEn: new Date() });
      return 'enviado';
    } catch (e) {
      console.error('[asignación] no se pudo enviar el aviso:', e.message);
      await ref.set({ ...registro, estado: 'error', ok: false, error: String(e.message).slice(0, 200) }).catch(() => {});
      return 'error';
    }
  })();
  return Promise.race([envio, new Promise((r) => setTimeout(() => r('error'), ESPERA_MAX_MS))]);
}

module.exports = { avisarAsignacion };
