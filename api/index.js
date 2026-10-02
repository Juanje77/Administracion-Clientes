// Punto de entrada de la API en Vercel: toda petición a /api/* llega a esta función
// (ver "rewrites" en vercel.json). Es la misma app Express que se usa en local.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  throw new Error('Falta la variable de entorno JWT_SECRET (mínimo 16 caracteres)');
}
module.exports = require('../backend/src/app');
