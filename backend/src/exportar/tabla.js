// Genera Excel, CSV y PDF a partir de una tabla: { titulo, columnas: [{ titulo, ancho, tipo }], filas, pie }.
// tipo: 'texto' (por defecto) | 'dinero' | 'numero'.
const PDFDocument = require('pdfkit');
const writeXlsxFile = require('write-excel-file/node').default;

const dinero = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
const fmt = (v, tipo) => (v === null || v === undefined || v === '' ? '' : tipo === 'dinero' ? dinero.format(v) : String(v));

async function aXlsx({ hoja = 'Datos', columnas, filas, pie }) {
  const cabecera = columnas.map((c) => ({ value: c.titulo, fontWeight: 'bold' }));
  const cuerpo = filas.map((f) => f.map((v, i) => {
    const tipo = columnas[i].tipo;
    if (v === null || v === undefined || v === '') return { value: '', type: String };
    if (tipo === 'dinero') return { value: v, type: Number, format: '#,##0.00' };
    if (tipo === 'numero') return { value: v, type: Number };
    return { value: String(v), type: String };
  }));
  // Fila de totales (si la hay), en negrita
  const total = pie ? [pie.map((v, i) => (v === '' || v === null ? { value: '', type: String }
    : typeof v === 'number' ? { value: v, type: Number, format: '#,##0.00', fontWeight: 'bold' } : { value: String(v), type: String, fontWeight: 'bold' }))] : [];
  const archivo = writeXlsxFile([cabecera, ...cuerpo, ...total], { sheet: hoja, columns: columnas.map((c) => ({ width: c.ancho ?? 18 })) });
  return Buffer.from(await archivo.toBuffer());
}

// CSV pensado para Excel en español: separador ";" y BOM para que respete las tildes.
function aCsv({ columnas, filas }) {
  const celda = (v) => {
    const t = v === null || v === undefined ? '' : String(v);
    // Si empieza con = + - @ Excel lo trataría como fórmula: se antepone una comilla simple.
    const seguro = /^[=+\-@]/.test(t) && Number.isNaN(Number(t)) ? `'${t}` : t;
    return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
  };
  const lineas = [columnas.map((c) => celda(c.titulo)), ...filas.map((f) => f.map(celda))].map((l) => l.join(';'));
  return Buffer.from('﻿' + lineas.join('\r\n') + '\r\n', 'utf8');
}

function aPdf({ titulo, subtitulo, columnas, filas, pie }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: titulo } });
    const partes = [];
    doc.on('data', (d) => partes.push(d));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.on('error', reject);

    const ancho = doc.page.width - 80;
    const sumaAnchos = columnas.reduce((t, c) => t + (c.ancho ?? 1), 0);
    const anchos = columnas.map((c) => (ancho * (c.ancho ?? 1)) / sumaAnchos);
    const alto = 18;
    const alinear = (c) => (c.tipo === 'dinero' || c.tipo === 'numero' ? 'right' : 'left');

    const fila = (valores, y, { negrita = false, fondo = null } = {}) => {
      if (fondo) doc.rect(40, y - 3, ancho, alto).fill(fondo);
      doc.fillColor('#1e293b').font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      let x = 40;
      valores.forEach((v, i) => {
        doc.text(v, x + 3, y, { width: anchos[i] - 6, height: alto - 4, align: alinear(columnas[i]), lineBreak: false, ellipsis: true });
        x += anchos[i];
      });
    };
    const encabezado = () => {
      doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a').text(titulo, 40, 40);
      if (subtitulo) doc.font('Helvetica').fontSize(9).fillColor('#475569').text(subtitulo, 40, doc.y + 2);
      doc.moveDown(0.8);
    };

    encabezado();
    let y = doc.y;
    const cabecera = () => { fila(columnas.map((c) => c.titulo), y, { negrita: true, fondo: '#e2e8f0' }); y += alto + 2; };
    cabecera();
    filas.forEach((f, i) => {
      if (y > doc.page.height - 70) { doc.addPage(); y = 40; cabecera(); }
      fila(f.map((v, j) => fmt(v, columnas[j].tipo)), y, { fondo: i % 2 ? '#f8fafc' : null });
      y += alto;
    });
    if (pie) {
      if (y > doc.page.height - 70) { doc.addPage(); y = 40; }
      doc.moveTo(40, y).lineTo(40 + ancho, y).strokeColor('#94a3b8').lineWidth(0.5).stroke();
      y += 4;
      fila(pie.map((v, j) => fmt(v, columnas[j].tipo)), y, { negrita: true });
    }
    const paginas = doc.bufferedPageRange();
    for (let i = 0; i < paginas.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(8).fillColor('#64748b')
        .text(`Página ${i + 1} de ${paginas.count}`, 40, doc.page.height - 30, { width: ancho, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

const TIPOS = {
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', generar: aXlsx },
  csv: { mime: 'text/csv; charset=utf-8', generar: async (t) => aCsv(t) },
  pdf: { mime: 'application/pdf', generar: aPdf },
};

module.exports = { aXlsx, aCsv, aPdf, TIPOS, fmt };
