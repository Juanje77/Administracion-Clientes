const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { requiereLogin } = require('./middleware/auth');

const app = express();
// Detrás del proxy del hosting (Vercel): sin esto el límite de intentos de login vería siempre la misma IP.
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/salud', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clientes', requiereLogin, require('./routes/clientes'));
app.use('/api/usuarios', requiereLogin, require('./routes/usuarios'));
app.use('/api/tareas', requiereLogin, require('./routes/tareas'));
app.use('/api/vencimientos', requiereLogin, require('./routes/vencimientos'));
app.use('/api/alertas', requiereLogin, require('./routes/alertas'));
app.use('/api/calendarios', requiereLogin, require('./routes/calendarios'));
app.use('/api/importacion', requiereLogin, require('./routes/importacion'));
app.use('/api/honorarios', requiereLogin, require('./routes/honorarios'));
app.use('/api/dashboard', requiereLogin, require('./routes/dashboard'));
app.use('/api/exportar', requiereLogin, require('./routes/exportar'));

// En producción el mismo servidor entrega el frontend compilado.
const dist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Manejo de errores genérico: no filtra detalles internos.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
