const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { puedeVerDinero } = require('../permisos');

const SECRET = () => process.env.JWT_SECRET;

function firmar(usuario) {
  return jwt.sign({ id: usuario.id, rol: usuario.rol }, SECRET(), { expiresIn: '8h' });
}

// El rol y los permisos se leen de la base de datos (no del token): así, desactivar a alguien o quitarle el
// acceso a los montos surte efecto enseguida y no recién cuando vence su sesión (8 h). Para no leer la base en
// cada petición se guarda una copia 30 s en memoria; los cambios hechos en el mismo servidor la invalidan al instante.
const TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 30 * 1000;
const copias = new Map();

async function cargarUsuario(id) {
  const c = copias.get(id);
  if (c && c.expira > Date.now()) return c.usuario;
  const doc = await db.collection('usuarios').doc(id).get();
  const d = doc.exists ? doc.data() : null;
  const usuario = d && d.activo !== false
    ? { id, nombre: d.nombre, email: d.email, rol: d.rol, verDinero: puedeVerDinero(d) }
    : null;
  if (TTL_MS) copias.set(id, { usuario, expira: Date.now() + TTL_MS });
  return usuario;
}
const olvidarUsuario = (id) => copias.delete(id);

// Exige sesión válida (cookie httpOnly "token") de un usuario que sigue activo.
async function requiereLogin(req, res, next) {
  let id;
  try {
    id = jwt.verify(req.cookies.token, SECRET()).id;
  } catch {
    return res.status(401).json({ error: 'No autenticado' });
  }
  const usuario = await cargarUsuario(id);
  if (!usuario) return res.status(401).json({ error: 'No autenticado' });
  req.usuario = usuario;
  next();
}

function requiereAdmin(req, res, next) {
  if (req.usuario?.rol !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

// Honorarios, cobros, deudas y cualquier otro dato de dinero.
function requiereDinero(req, res, next) {
  if (!req.usuario?.verDinero) return res.status(403).json({ error: 'No tienes acceso a los datos de dinero' });
  next();
}

module.exports = { firmar, requiereLogin, requiereAdmin, requiereDinero, olvidarUsuario };
