// Configuración y control de los avisos por email. Solo administradores.
const router = require('express').Router();
const { requiereAdmin } = require('../middleware/auth');
const { avisosConfigSchema } = require('../validacion');
const correo = require('../correo/transporte');
const { db } = require('../db');
const A = require('../servicios/avisos');

router.use(requiereAdmin);

router.get('/config', async (_req, res) => {
  res.json({
    config: await A.leerConfig(),
    correo: { configurado: correo.configurado(), remitente: correo.configurado() ? correo.remitente() : null },
    cron: { configurado: Boolean(process.env.CRON_SECRET) },
  });
});

router.put('/config', async (req, res) => {
  const r = avisosConfigSchema.safeParse(req.body);
  if (!r.success) return res.status(400).json({ error: 'Datos inválidos', detalles: r.error.flatten().fieldErrors });
  res.json(await A.guardarConfig(r.data));
});

// Envía un email de prueba al propio administrador.
router.post('/prueba', async (req, res) => {
  const u = await db.collection('usuarios').doc(req.usuario.id).get();
  await A.enviarPrueba(u.data().email);
  res.json({ ok: true, a: u.data().email });
});

// Lo que se enviaría hoy, sin enviar nada.
router.get('/vista-previa', async (_req, res) => res.json(await A.ejecutar({ simular: true })));

// Ejecuta los avisos ahora (lo mismo que hace el cron). No repite lo ya enviado hoy.
router.post('/ejecutar', async (_req, res) => res.json(await A.ejecutar({})));

router.get('/historial', async (_req, res) => res.json(await A.historial()));

module.exports = router;
