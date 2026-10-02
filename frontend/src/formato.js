const moneda = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
export const pesos = (n) => moneda.format(n ?? 0);
export const mesActual = () => new Date().toLocaleDateString('en-CA').slice(0, 7);
export const hoyISO = () => new Date().toLocaleDateString('en-CA');
