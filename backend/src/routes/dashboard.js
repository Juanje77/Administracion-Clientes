// Panel de inicio: totales del estudio. Las sumas usan consultas de agregación de Firestore
// (cuestan ~1 lectura cada una sin importar cuántos documentos sumen).
const router = require('express').Router();
const { AggregateField } = require('firebase-admin/firestore');
const { db } = require('../db');
const { todosLosClientes } = require('../cache');
const { resumenAlertas } = require('../servicios/alertas');
const { deudores, mesActual, redondear } = require('../servicios/honorarios');
const { periodo: periodoSchema } = require('../validacion');

const suma = async (consulta, campo) => redondear((await consulta.aggregate({ total: AggregateField.sum(campo) }).get()).data().total ?? 0);

// ["2026-05", ..., "2026-10"] terminando en `hasta`
function ultimosMeses(hasta, n) {
  const [a, m] = hasta.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(a, m - 1 - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

router.get('/', async (req, res) => {
  const parsed = periodoSchema.safeParse(req.query.periodo ?? mesActual());
  if (!parsed.success) return res.status(400).json({ error: 'Período inválido (AAAA-MM)' });
  const periodo = parsed.data;

  const cobradoDe = (m) => suma(db.collection('pagos').where('fecha', '>=', `${m}-01`).where('fecha', '<=', `${m}-31`), 'monto');
  const facturadoDe = (m) => suma(db.collection('honorarios').where('periodo', '==', m), 'monto');
  const meses = ultimosMeses(periodo, 6);

  const [clientes, alertas, deuda, serie] = await Promise.all([
    todosLosClientes(),
    resumenAlertas(req.usuario.id),
    deudores(),
    Promise.all(meses.map(async (m) => ({ periodo: m, cobrado: await cobradoDe(m), facturado: await facturadoDe(m) }))),
  ]);

  const actual = serie[serie.length - 1];
  res.json({
    periodo,
    clientes: {
      total: clientes.length,
      activos: clientes.filter((c) => c.estado === 'ACTIVO').length,
      potenciales: clientes.filter((c) => c.estado === 'POTENCIAL').length,
      inactivos: clientes.filter((c) => c.estado === 'INACTIVO').length,
      nuevosMes: clientes.filter((c) => c.creadoEn && c.creadoEn.toISOString().slice(0, 7) === periodo).length,
    },
    honorarios: {
      facturado: actual.facturado,
      cobrado: actual.cobrado,
      deudaTotal: deuda.total,
      deudoresCantidad: deuda.datos.length,
      topDeudores: deuda.datos.slice(0, 5),
    },
    serie,
    agenda: alertas,
  });
});

module.exports = router;
