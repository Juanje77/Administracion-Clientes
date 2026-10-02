// Punto de entrada del cron de Vercel (vercel.json -> crons). Vercel envía "Authorization: Bearer <CRON_SECRET>".
// Sin CRON_SECRET configurado el endpoint queda cerrado: nunca se ejecuta sin credencial.
const crypto = require('crypto');
const router = require('express').Router();
const correo = require('../correo/transporte');
const A = require('../servicios/avisos');

function autorizado(req) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) return null;
  const recibido = String(req.headers.authorization || '');
  const esperado = `Bearer ${secreto}`;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get('/avisos', async (req, res) => {
  const ok = autorizado(req);
  if (ok === null) return res.status(503).json({ error: 'Cron deshabilitado: falta la variable CRON_SECRET' });
  if (!ok) return res.status(401).json({ error: 'No autorizado' });
  if (!correo.configurado()) return res.json({ omitido: 'El correo no está configurado (SMTP_USER / SMTP_PASS)' });
  res.json(await A.ejecutar({}));
});

module.exports = router;
