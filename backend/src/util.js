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

// Campos auxiliares para consultar pendientes SIN índices compuestos y sin leer todo el historial.
// Solo existen mientras el elemento está pendiente (al cerrarlo pasan a null y salen de las consultas):
//   alerta   = fecha de vencimiento                     -> "pendientes hasta tal fecha" (rango sobre un solo campo)
//   alertaDe = "<usuario>|<fecha>" (solo tareas)        -> "pendientes de este usuario hasta tal fecha"
const alertaTarea = (t) => (t.hecha
  ? { alerta: null, alertaDe: null }
  : { alerta: t.vence, alertaDe: `${t.asignadoA ?? ''}|${t.vence}` });
const alertaVencimiento = (v) => ({ alerta: v.estado === 'PRESENTADO' ? null : v.vence });

// Días hacia adelante que muestra la Agenda (además de todo lo vencido).
function diasAgenda(valor) {
  const n = Number(valor);
  return [7, 15, 30].includes(n) ? n : DIAS_ALERTA;
}
const LIMITE_AGENDA = 500;

module.exports = { hoy, sumarDias, situacion, mapaClientes, mapaUsuarios, porFecha, DIAS_ALERTA, alertaTarea, alertaVencimiento, diasAgenda, LIMITE_AGENDA };
