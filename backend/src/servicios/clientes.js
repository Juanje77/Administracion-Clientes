// Filtros y orden de la lista de clientes (compartidos por la pantalla y la exportación).
const COLUMNAS_ORDEN = ['razonSocial', 'cuit', 'email', 'telefono', 'ciudad', 'estado', 'creadoEn'];

// Minúsculas y sin tildes: "García" se encuentra buscando "garcia".
const plano = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function filtrarYOrdenar(lista, { q, estado, ciudad, etiqueta, orden = 'razonSocial', dir = 'asc' } = {}) {
  let r = lista;
  if (q) {
    const buscado = plano(q);
    r = r.filter((c) => ['razonSocial', 'email', 'telefono', 'cuit'].some((k) => plano(c[k]).includes(buscado)));
  }
  if (['ACTIVO', 'INACTIVO', 'POTENCIAL'].includes(estado)) r = r.filter((c) => c.estado === estado);
  if (ciudad) r = r.filter((c) => plano(c.ciudad) === plano(ciudad));
  if (etiqueta) r = r.filter((c) => (c.etiquetas || []).includes(String(etiqueta).toLowerCase()));

  const campo = COLUMNAS_ORDEN.includes(orden) ? orden : 'razonSocial';
  const signo = dir === 'desc' ? -1 : 1;
  return [...r].sort((a, b) => {
    const x = a[campo], y = b[campo];
    if (x == null && y == null) return 0;
    if (x == null) return 1; // los vacíos siempre al final
    if (y == null) return -1;
    if (x instanceof Date) return signo * (x - y);
    return signo * String(x).localeCompare(String(y), 'es', { sensitivity: 'base', numeric: true });
  });
}

module.exports = { filtrarYOrdenar, plano };
