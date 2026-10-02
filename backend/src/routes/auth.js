const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const prisma = require('../db');
const { firmar, requiereLogin } = require('../middleware/auth');

// Freno a ataques de fuerza bruta sobre el login.
const limitador = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/login', limitador, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const u = await prisma.usuario.findUnique({ where: { email } });
  const ok = u && u.activo && (await bcrypt.compare(String(req.body.password || ''), u.passwordHash));
  if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  res.cookie('token', firmar(u), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 3600 * 1000,
  });
  res.json({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', requiereLogin, async (req, res) => {
  const u = await prisma.usuario.findUnique({ where: { id: req.usuario.id } });
  if (!u || !u.activo) return res.status(401).json({ error: 'No autenticado' });
  res.json({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol });
});

module.exports = router;
