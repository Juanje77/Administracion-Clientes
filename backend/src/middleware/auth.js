const jwt = require('jsonwebtoken');

const SECRET = () => process.env.JWT_SECRET;

function firmar(usuario) {
  return jwt.sign({ id: usuario.id, rol: usuario.rol }, SECRET(), { expiresIn: '8h' });
}

// Exige sesión válida (cookie httpOnly "token").
function requiereLogin(req, res, next) {
  try {
    req.usuario = jwt.verify(req.cookies.token, SECRET());
    next();
  } catch {
    res.status(401).json({ error: 'No autenticado' });
  }
}

function requiereAdmin(req, res, next) {
  if (req.usuario?.rol !== 'ADMIN') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

module.exports = { firmar, requiereLogin, requiereAdmin };
