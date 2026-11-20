// Quién puede ver y gestionar DINERO (honorarios, cobros, deudas, abono mensual, totales).
// Los administradores siempre pueden. Cualquier otro usuario, solo si un administrador se lo concedió.
// Por defecto un usuario nuevo NO tiene acceso.
const puedeVerDinero = (u) => Boolean(u) && (u.rol === 'ADMIN' || u.verDinero === true);

// Qué clientes puede ver una persona. Los administradores ven todos. Un usuario común ve todos solo si es
// "TODOS" (así quedaron los usuarios anteriores a este permiso) y, si es "ASIGNADOS", únicamente los clientes
// donde figura en `responsables`. Los usuarios nuevos se crean como ASIGNADOS: no ven ningún cliente hasta
// que se les asigne alguno.
const veTodosLosClientes = (u) => Boolean(u) && (u.rol === 'ADMIN' || u.accesoClientes !== 'ASIGNADOS');

// Claves de ARCA y Rentas de los clientes: todo el equipo (cada persona ve solo los clientes que tiene asignados).
const puedeVerClaves = (u) => Boolean(u);

module.exports = { puedeVerDinero, veTodosLosClientes, puedeVerClaves };
