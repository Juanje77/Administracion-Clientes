// Las fechas llegan como "AAAA-MM-DD"; se reordenan sin pasar por Date (evita desfases de zona horaria).
export const verFecha = (f) => (f ? f.split('-').reverse().join('/') : '');

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
// "2026-10" -> "Octubre 2026"
export const nombrePeriodo = (p) => (p ? `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}` : '');
