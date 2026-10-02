// Pequeño cliente de la API: envía la cookie de sesión y normaliza errores.
export class ErrorApi extends Error {
  constructor(mensaje, estado, detalles) {
    super(mensaje);
    this.estado = estado;
    this.detalles = detalles || {};
  }
}

export async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  const r = await fetch(`/api${ruta}`, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    credentials: 'same-origin',
  });
  if (r.status === 204) return null;
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErrorApi(datos.error || 'Error inesperado', r.status, datos.detalles);
  return datos;
}
