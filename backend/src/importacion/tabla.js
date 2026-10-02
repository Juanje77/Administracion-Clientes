// Lee una planilla (.xlsx o .csv) y devuelve sus filas como texto: { filas: [{ n, celdas: [..] }] }
// `n` es el número de fila en la planilla original, para poder avisar "fila 17: ...".
const { readSheet } = require('read-excel-file/node');

const MAX_FILAS = 5000;

function aTexto(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
}

// Lee un CSV respetando comillas ("a;b" dentro de una celda) y saltos de línea entre comillas.
function parsearCsv(texto, delimitador) {
  const filas = [];
  let fila = [];
  let celda = '';
  let entreComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') { celda += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else celda += c;
    } else if (c === '"') entreComillas = true;
    else if (c === delimitador) { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(celda); celda = '';
      filas.push(fila); fila = [];
    } else celda += c;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

function decodificar(buffer) {
  let texto = new TextDecoder('utf-8').decode(buffer);
  // Los CSV guardados por Excel en Windows suelen venir en Windows-1252, no en UTF-8.
  if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buffer);
  return texto.replace(/^﻿/, '');
}

function elegirDelimitador(texto) {
  const primera = texto.split(/\r?\n/).find((l) => l.trim()) || '';
  const cuenta = (d) => primera.split(d).length - 1;
  return [';', ',', '\t'].sort((a, b) => cuenta(b) - cuenta(a))[0];
}

async function leerTabla(buffer) {
  let crudas;
  if (buffer.subarray(0, 2).toString() === 'PK') {
    try {
      crudas = await readSheet(buffer);
    } catch {
      throw new Error('No se pudo leer el archivo Excel. Guárdalo como .xlsx e inténtalo de nuevo.');
    }
  } else {
    const texto = decodificar(buffer);
    crudas = parsearCsv(texto, elegirDelimitador(texto));
  }
  const filas = crudas
    .map((celdas, i) => ({ n: i + 1, celdas: celdas.map(aTexto) }))
    .filter((f) => f.celdas.some(Boolean));
  if (filas.length < 2) throw new Error('El archivo no tiene datos: necesita una fila de encabezados y al menos un cliente.');
  if (filas.length > MAX_FILAS) throw new Error(`El archivo tiene más de ${MAX_FILAS} filas. Divídelo en partes.`);
  return filas;
}

module.exports = { leerTabla, MAX_FILAS };
