// Quién puede ver y gestionar DINERO (honorarios, cobros, deudas, abono mensual, totales).
// Los administradores siempre pueden. Cualquier otro usuario, solo si un administrador se lo concedió.
// Por defecto un usuario nuevo NO tiene acceso.
const puedeVerDinero = (u) => Boolean(u) && (u.rol === 'ADMIN' || u.verDinero === true);

module.exports = { puedeVerDinero };
