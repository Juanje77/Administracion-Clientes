// Envío de emails por SMTP (por defecto Gmail con "contraseña de aplicación").
// Variables: SMTP_USER, SMTP_PASS (obligatorias), SMTP_HOST (smtp.gmail.com), SMTP_PORT (465),
// MAIL_FROM (opcional), MAIL_REPLY_TO (opcional), ESTUDIO_NOMBRE.
const nodemailer = require('nodemailer');
const { errorConfig } = require('../db');

let transporte = null;
let reemplazo = null; // para los tests

const configurado = () => Boolean(reemplazo || (process.env.SMTP_USER && process.env.SMTP_PASS));
const estudio = () => process.env.ESTUDIO_NOMBRE || 'Estudio Contable';
const remitente = () => process.env.MAIL_FROM || `"${estudio()}" <${process.env.SMTP_USER}>`;

function obtener() {
  if (reemplazo) return reemplazo;
  if (!configurado()) {
    throw errorConfig('El correo no está configurado: faltan las variables SMTP_USER y SMTP_PASS (ver README, sección Avisos por email)');
  }
  if (!transporte) {
    const puerto = Number(process.env.SMTP_PORT) || 465;
    transporte = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: puerto,
      secure: puerto === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transporte;
}

async function enviar({ to, subject, html, text, replyTo }) {
  await obtener().sendMail({
    from: remitente(),
    to,
    subject,
    html,
    text,
    replyTo: replyTo || process.env.MAIL_REPLY_TO || undefined,
  });
}

function usarTransporteDePrueba(t) { reemplazo = t; }

module.exports = { enviar, configurado, remitente, estudio, usarTransporteDePrueba };
