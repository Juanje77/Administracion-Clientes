// Punto de entrada de la API en Vercel: toda petición a /api/* llega a esta función
// (ver "rewrites" en vercel.json). Es la misma app Express que se usa en local.
//
// Si la configuración está incompleta, en vez de caerse (Vercel mostraría un error opaco) se responde
// con un mensaje claro. Solo se muestran los mensajes marcados como seguros (`configuracion`); el
// detalle técnico va a los logs de Vercel (Project → Logs).
let app = null;
let errorInicio = null;

try {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    const e = new Error('Falta la variable de entorno JWT_SECRET (mínimo 16 caracteres)');
    e.configuracion = true;
    throw e;
  }
  app = require('../backend/src/app');
} catch (e) {
  errorInicio = e;
  console.error('[inicio] No se pudo iniciar la API:', e.configuracion ? e.message : e);
}

module.exports = (req, res) => {
  if (errorInicio) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      error: errorInicio.configuracion
        ? `Error de configuración del servidor: ${errorInicio.message}`
        : 'El servidor no pudo iniciar. Revisa los logs del proyecto en Vercel.',
    }));
    return;
  }
  return app(req, res);
};
