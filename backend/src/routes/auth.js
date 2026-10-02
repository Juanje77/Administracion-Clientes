const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { firmar, requiereLogin } = require('../middleware/auth');

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

module.exports = router;
