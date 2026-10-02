// Pequeño cliente de la API: envía la cookie de sesión y normaliza errores.
export class ErrorApi extends Error {
  constructor(mensaje, estado, detalles) {
    super(mensaje);
    this.estado = estado;
    this.detalles = detalles || {};
  }
}

export async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  const esArchivo = typeof Blob !== 'undefined' && cuerpo instanceof Blob;
  const r = await fetch(`/api${ruta}`, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': esArchivo ? cuerpo.type : 'application/json' } : undefined,
    body: cuerpo ? (esArchivo ? cuerpo : JSON.stringify(cuerpo)) : undefined,
    credentials: 'same-origin',
  });
  if (r.status === 204) return null;
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Si el servidor no respondió con JSON (error de la plataforma), al menos mostrar el código.
    throw new ErrorApi(datos.error || `El servidor respondió con un error (código ${r.status}). Intenta de nuevo o revisa los logs del hosting.`, r.status, datos.detalles);
  }
  return datos;
}
