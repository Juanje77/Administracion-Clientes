const { db } = require('./db');
const { todosLosClientes } = require('./cache');

// Las fechas de vencimiento son "AAAA-MM-DD" (sin hora) para evitar líos de zona horaria.
// "Hoy" se calcula en la zona horaria del estudio.
const ZONA = () => process.env.TZ_NEGOCIO || 'America/Argentina/Buenos_Aires';

function hoy() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA() }).format(new Date());
}

function sumarDias(fecha, dias) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const DIAS_ALERTA = 7;

// Estado de un pendiente según su fecha: VENCIDA | HOY | PROXIMA (≤7 días) | FUTURA
function situacion(vence, hecho) {
  if (hecho) return 'CERRADA';
  const h = hoy();
  if (vence < h) return 'VENCIDA';
  if (vence === h) return 'HOY';
  return vence <= sumarDias(h, DIAS_ALERTA) ? 'PROXIMA' : 'FUTURA';
}

// Nombres de clientes y usuarios para mostrar en las listas (se resuelven al leer,
// así un cambio de nombre se refleja en todas partes).
async function mapaClientes() {
  return new Map((await todosLosClientes()).map((c) => [c.id, c.razonSocial]));
}
async function mapaUsuarios() {
  const snap = await db.collection('usuarios').get();
  return new Map(snap.docs.map((d) => [d.id, d.data().nombre]));
}

const porFecha = (a, b) => a.vence.localeCompare(b.vence) || (a.clienteNombre || '').localeCompare(b.clienteNombre || '', 'es');

module.exports = { hoy, sumarDias, situacion, mapaClientes, mapaUsuarios, porFecha, DIAS_ALERTA };
