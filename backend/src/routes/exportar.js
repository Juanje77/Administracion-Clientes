// Descargas: clientes (Excel/CSV), honorarios del mes y deudores (Excel/PDF).
const router = require('express').Router();
const { clientesVisibles, idsVisibles } = require('../servicios/acceso');
const { filtrarYOrdenar } = require('../servicios/clientes');
const { consultar, deudores } = require('../servicios/honorarios');
const { TIPOS } = require('../exportar/tabla');
const { hoy } = require('../util');
const { requiereDinero } = require('../middleware/auth');
const { periodo: periodoSchema } = require('../validacion');

const ESTADO = { ACTIVO: 'Activo', INACTIVO: 'Inactivo', POTENCIAL: 'Potencial' };
const PERSONA = { FISICA: 'Física', JURIDICA: 'Jurídica' };
const COBRO = { PENDIENTE: 'Pendiente', PARCIAL: 'Parcial', PAGADO: 'Pagado' };
const fecha = (d) => (d ? d.toISOString().slice(0, 10).split('-').reverse().join('/') : '');

async function enviar(res, formato, tabla, nombre, permitidos) {
  const tipo = TIPOS[formato];
  if (!tipo || !permitidos.includes(formato)) return res.status(400).json({ error: `Formato no disponible (usa ${permitidos.join(' o ')})` });
  const buffer = await tipo.generar(tabla);
  res.setHeader('Content-Type', tipo.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}-${hoy()}.${formato}"`);
  res.send(buffer);
}

// Las columnas coinciden con la plantilla de importación: el Excel exportado se puede volver a importar.
router.get('/clientes.:formato', async (req, res) => {
  const lista = filtrarYOrdenar(await clientesVisibles(req.usuario), req.query);
  const tabla = {
    hoja: 'Clientes',
    columnas: [
      { titulo: 'Nombre / Razón social', ancho: 34 }, { titulo: 'CUIT', ancho: 16 }, { titulo: 'Email', ancho: 28 }, { titulo: 'Teléfono', ancho: 16 },
      { titulo: 'Dirección', ancho: 28 }, { titulo: 'Ciudad', ancho: 16 }, { titulo: 'Estado', ancho: 11 }, { titulo: 'Tipo de persona', ancho: 14 },
      { titulo: 'Condición IVA', ancho: 22 }, { titulo: 'Régimen', ancho: 18 }, { titulo: 'Mes de cierre de balance', ancho: 14 }, { titulo: 'Etiquetas', ancho: 22 },
      { titulo: 'Abono mensual', ancho: 15, tipo: 'dinero' }, { titulo: 'Notas', ancho: 40 }, { titulo: 'Alta', ancho: 12 },
    ],
    filas: lista.map((c) => [c.razonSocial, c.cuit, c.email, c.telefono, c.direccion, c.ciudad, ESTADO[c.estado], PERSONA[c.tipoPersona], c.condicionIva,
      c.regimen, c.cierreMes ?? '', (c.etiquetas || []).join(', '), c.abonoMensual, c.notas, fecha(c.creadoEn)]),
  };
  // El abono mensual es dinero: quien no tiene acceso a los montos no lo recibe en la planilla.
  if (!req.usuario.verDinero) {
    const i = tabla.columnas.findIndex((c) => c.titulo === 'Abono mensual');
    tabla.columnas.splice(i, 1);
    tabla.filas = tabla.filas.map((f) => f.filter((_, j) => j !== i));
  }
  await enviar(res, req.params.formato, tabla, 'clientes', ['xlsx', 'csv']);
});

router.get('/honorarios.:formato', requiereDinero, async (req, res) => {
  const p = periodoSchema.safeParse(req.query.periodo ?? hoy().slice(0, 7));
  if (!p.success) return res.status(400).json({ error: 'Período inválido (AAAA-MM)' });
  const { datos, totales } = await consultar({ periodo: p.data, estado: req.query.estado, q: req.query.q }, await idsVisibles(req.usuario));
  await enviar(res, req.params.formato, {
    hoja: `Honorarios ${p.data}`,
    titulo: `Honorarios ${p.data}`,
    subtitulo: `${datos.length} honorarios · emitido el ${hoy().split('-').reverse().join('/')}`,
    columnas: [
      { titulo: 'Cliente', ancho: 30 }, { titulo: 'Concepto', ancho: 22 }, { titulo: 'Facturado', ancho: 15, tipo: 'dinero' },
      { titulo: 'Cobrado', ancho: 15, tipo: 'dinero' }, { titulo: 'Saldo', ancho: 15, tipo: 'dinero' }, { titulo: 'Estado', ancho: 12 },
    ],
    filas: datos.map((h) => [h.clienteNombre, h.concepto, h.monto, h.pagado, h.saldo, COBRO[h.estado] + (h.vencido ? ' (vencido)' : '')]),
    pie: ['TOTAL', '', totales.monto, totales.pagado, totales.saldo, ''],
  }, 'honorarios', ['xlsx', 'pdf']);
});

router.get('/deudores.:formato', requiereDinero, async (req, res) => {
  const { datos, total } = await deudores(await idsVisibles(req.usuario));
  await enviar(res, req.params.formato, {
    hoja: 'Deudores',
    titulo: 'Deudores',
    subtitulo: `${datos.length} clientes con saldo pendiente · emitido el ${hoy().split('-').reverse().join('/')}`,
    columnas: [
      { titulo: 'Cliente', ancho: 36 }, { titulo: 'Períodos adeudados', ancho: 18, tipo: 'numero' }, { titulo: 'Desde', ancho: 12 }, { titulo: 'Saldo', ancho: 18, tipo: 'dinero' },
    ],
    filas: datos.map((d) => [d.clienteNombre, d.cantidad, d.masAntiguo, d.saldo]),
    pie: ['TOTAL', '', '', total],
  }, 'deudores', ['xlsx', 'pdf']);
});

module.exports = router;
