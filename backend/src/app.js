const path = require('path');
const fs = require('fs');
// Hace que los errores lanzados dentro de rutas asíncronas lleguen al manejador de errores de abajo
// (Express 4 no lo hace solo: sin esto la petición queda colgada y el proceso puede caerse).
require('express-async-errors');
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
app.use('/api/documentos', requiereLogin, require('./routes/documentos'));
app.use('/api/avisos', requiereLogin, require('./routes/avisos'));
// El cron no usa sesión: se autentica con CRON_SECRET (ver routes/cron.js)
app.use('/api/cron', require('./routes/cron'));

// En producción el mismo servidor entrega el frontend compilado.
const dist = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Manejo de errores genérico: no filtra detalles internos.
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'El archivo es demasiado grande (máximo 4 MB)' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Los datos enviados no son válidos' });
  // Errores de configuración con mensaje seguro (ej. Storage sin configurar)
  if (err.configuracion) return res.status(503).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;
