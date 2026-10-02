// Panel de inicio: totales del estudio. Las sumas usan consultas de agregación de Firestore
// (cuestan ~1 lectura cada una sin importar cuántos documentos sumen).
const router = require('express').Router();
const { clientesVisibles } = require('../servicios/acceso');
const { requiereAdmin } = require('../middleware/auth');
const { resumenAlertas } = require('../servicios/alertas');
const { deudores, mesActual } = require('../servicios/honorarios');
const { leerSerie, asegurarResumenes, recalcular } = require('../servicios/resumenes');
const { periodo: periodoSchema } = require('../validacion');

// ["2026-05", ..., "2026-10"] terminando en `hasta`
function ultimosMeses(hasta, n) {
  const [a, m] = hasta.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

// Cada bloque se carga por separado: si uno falla, el Inicio igual muestra los demás y avisa cuál faltó.
router.get('/', async (req, res) => {
  const parsed = periodoSchema.safeParse(req.query.periodo ?? mesActual());
  if (!parsed.success) return res.status(400).json({ error: 'Período inválido (AAAA-MM)' });
  const periodo = parsed.data;
  const avisos = [];
  // Quien no tiene acceso a los montos ni siquiera los calcula. Los totales del estudio (facturado, cobrado, deuda
  // total) tampoco los ve quien solo tiene algunos clientes: para él se muestran en la pantalla de Honorarios.
  const dinero = req.usuario.verDinero && req.usuario.todosLosClientes;
  const tomar = (r, nombre) => {
    if (r.status === 'fulfilled') return r.value;
    console.error(`[dashboard] ${nombre}:`, r.reason);
    avisos.push(`No se pudo cargar: ${nombre}.`);
    return null;
  };

  const [rClientes, rAgenda, rDeuda, rSerie] = await Promise.allSettled([
    clientesVisibles(req.usuario),
    resumenAlertas(req.usuario),
    dinero ? deudores() : Promise.resolve(null),
    dinero ? asegurarResumenes().then(() => leerSerie(ultimosMeses(periodo, 6))) : Promise.resolve(null),
  ]);
  const clientes = tomar(rClientes, 'clientes');
  const agenda = tomar(rAgenda, 'pendientes urgentes');
  const deuda = tomar(rDeuda, 'deudores');
  const serie = tomar(rSerie, 'cobrado por mes');
  const actual = serie?.[serie.length - 1];

  res.json({
    periodo,
    dinero,
    avisos,
    clientes: clientes && {
      total: clientes.length,
      activos: clientes.filter((c) => c.estado === 'ACTIVO').length,
      potenciales: clientes.filter((c) => c.estado === 'POTENCIAL').length,
      inactivos: clientes.filter((c) => c.estado === 'INACTIVO').length,
      nuevosMes: clientes.filter((c) => c.creadoEn && c.creadoEn.toISOString().slice(0, 7) === periodo).length,
    },
    honorarios: dinero ? {
      facturado: actual?.facturado ?? null,
      cobrado: actual?.cobrado ?? null,
      deudaTotal: deuda?.total ?? null,
      deudoresCantidad: deuda?.datos.length ?? null,
      topDeudores: deuda?.datos.slice(0, 5) ?? [],
    } : null,
    serie,
    agenda,
  });
});

// Reconstruye los totales mensuales desde los honorarios y cobros existentes (por si algo quedó desfasado).
router.post('/recalcular', requiereAdmin, async (_req, res) => res.json(await recalcular()));

module.exports = router;
