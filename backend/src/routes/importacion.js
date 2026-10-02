// Importación masiva de clientes desde Excel/CSV: primero una vista previa (no guarda nada),
// después, con confirmar=1, crea los clientes. Solo administradores.
const express = require('express');
const router = express.Router();
const writeXlsxFile = require('write-excel-file/node').default;
const { db } = require('../db');
const { todosLosClientes, invalidar } = require('../cache');
const { requiereAdmin } = require('../middleware/auth');
const { leerTabla } = require('../importacion/tabla');
const { procesar, CAMPOS, ENCABEZADOS_PLANTILLA, EJEMPLO_PLANTILLA } = require('../importacion/clientes');

router.use(requiereAdmin);

router.get('/plantilla', async (_req, res) => {
  const negrita = (value) => ({ value, fontWeight: 'bold' });
  const datos = [ENCABEZADOS_PLANTILLA.map(negrita), EJEMPLO_PLANTILLA.map((value) => ({ value, type: String }))];
  const buffer = Buffer.from(await writeXlsxFile(datos).toBuffer());
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="plantilla-clientes.xlsx"');
  res.send(buffer);
});

const cuerpoArchivo = express.raw({ type: () => true, limit: '4mb' });
const claveCuit = (c) => c.replace(/\D/g, '');

router.post('/clientes', cuerpoArchivo, async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Sube un archivo Excel (.xlsx) o CSV' });

  let mapeoManual = null;
  if (req.query.mapeo) {
    try {
      const m = JSON.parse(req.query.mapeo);
      mapeoManual = Object.fromEntries(Object.entries(m).filter(([, campo]) => campo && CAMPOS[campo]));
    } catch { return res.status(400).json({ error: 'Mapeo de columnas inválido' }); }
  }

  let filas;
  try { filas = await leerTabla(req.body); } catch (e) { return res.status(422).json({ error: e.message }); }
  const vista = procesar(filas, mapeoManual, await todosLosClientes());
  if (req.query.confirmar !== '1') return res.json(vista);

  const aCrear = vista.filas.filter((f) => f.estado !== 'RECHAZADA');
  const ahora = new Date();
  const documento = (d) => ({ ...d, obligaciones: [], creadoEn: ahora, actualizadoEn: ahora });
  let creados = 0;
  let fallidos = 0;

  const porLotes = [];
  for (let i = 0; i < aCrear.length; i += 200) porLotes.push(aCrear.slice(i, i + 200));
  for (const lote of porLotes) {
    const refs = lote.map(() => db.collection('clientes').doc());
    try {
      const batch = db.batch();
      lote.forEach((f, i) => {
        batch.create(refs[i], documento(f.datos));
        if (f.datos.cuit) batch.create(db.collection('cuits').doc(claveCuit(f.datos.cuit)), { clienteId: refs[i].id });
      });
      await batch.commit();
      creados += lote.length;
    } catch {
      // Si algo falló en el lote (ej. un CUIT cargado en simultáneo), se reintenta fila por fila.
      for (const [i, f] of lote.entries()) {
        try {
          await db.runTransaction(async (tx) => {
            if (f.datos.cuit) {
              const ref = db.collection('cuits').doc(claveCuit(f.datos.cuit));
              if ((await tx.get(ref)).exists) throw new Error('duplicado');
              tx.set(ref, { clienteId: refs[i].id });
            }
            tx.set(refs[i], documento(f.datos));
          });
          creados++;
        } catch { fallidos++; }
      }
    }
  }
  await invalidar();
  res.status(201).json({ creados, fallidos, rechazadas: vista.resumen.rechazadas, conAdvertencias: vista.filas.filter((f) => f.estado === 'ADVERTENCIA').length });
});

module.exports = router;
