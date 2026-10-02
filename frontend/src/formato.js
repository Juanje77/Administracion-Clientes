const moneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
export const pesos = (n) => moneda.format(n ?? 0);
export const mesActual = () => new Date().toLocaleDateString('en-CA').slice(0, 7);
export const hoyISO = () => new Date().toLocaleDateString('en-CA');
const compacto = new Intl.NumberFormat('es-AR', { notation: 'compact', maximumFractionDigits: 1 });
export const pesosCortos = (n) => `$ ${compacto.format(n ?? 0)}`;
const ABREV = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const mesCorto = (p) => ABREV[Number(p.slice(5, 7)) - 1];

// Escala "linda" para el eje: 0 … máximo redondeado a 1, 2 o 5 × 10^n
export function escala(max) {
  if (max <= 0) return { tope: 1, marcas: [0] };
  const paso0 = max / 5; // hasta ~5 tramos
  const pot = 10 ** Math.floor(Math.log10(paso0));
  const paso = [1, 2, 5, 10].map((m) => m * pot).find((p) => p >= paso0);
  const tope = Math.ceil(max / paso) * paso;
  return { tope, marcas: Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso) };
}
