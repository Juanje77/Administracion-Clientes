const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { firmar, requiereLogin } = require('../middleware/auth');
const { passwordSchema } = require('../validacion');

// Freno a ataques de fuerza bruta sobre el login.
const limitador = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const publico = (id, u) => ({ id, nombre: u.nombre, email: u.email, rol: u.rol });

router.post('/login', limitador, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const snap = await db.collection('usuarios').where('email', '==', email).limit(1).get();
  const doc = snap.docs[0];
  const u = doc?.data();
  const ok = u && u.activo && (await bcrypt.compare(String(req.body.password || ''), u.passwordHash));
  if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  res.cookie('token', firmar({ id: doc.id, rol: u.rol }), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 3600 * 1000,
  });
  res.json(publico(doc.id, u));
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', requiereLogin, async (req, res) => {
  const doc = await db.collection('usuarios').doc(req.usuario.id).get();
  if (!doc.exists || !doc.data().activo) return res.status(401).json({ error: 'No autenticado' });
  res.json(publico(doc.id, doc.data()));
});

router.post('/password', requiereLogin, limitador, async (req, res) => {
  const r = passwordSchema.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: 'Datos inválidos', detalles: r.error.flatten().fieldErrors });
  const ref = db.collection('usuarios').doc(req.usuario.id);
  const u = (await ref.get()).data();
  if (!(await bcrypt.compare(r.data.actual, u.passwordHash))) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: { actual: ['La contraseña actual es incorrecta'] } });
  }
  if (r.data.actual === r.data.nueva) {
    return res.status(400).json({ error: 'Datos inválidos', detalles: { nueva: ['Debe ser distinta de la actual'] } });
  }
  await ref.update({ passwordHash: await bcrypt.hash(r.data.nueva, 12) });
  res.json({ ok: true });
});

module.exports = router;
