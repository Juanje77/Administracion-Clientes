// Las fechas llegan como "AAAA-MM-DD"; se reordenan sin pasar por Date (evita desfases de zona horaria).
export const verFecha = (f) => (f ? f.split('-').reverse().join('/') : '');
