// Lee el "Calendario de vencimientos" mensual (PDF de Errepar) y lo convierte en filas:
//   { seccion, obligacion, concepto, notas, fechas: { '0': 'AAAA-MM-DD', ..., '9': ... } }
//
// El PDF es una grilla: el texto trae coordenadas y las líneas de la tabla se leen del
// contenido gráfico, así se sabe qué filas abarca cada celda combinada (ej. "Anticipos").
// Es una lectura automática: el resultado SIEMPRE se revisa en pantalla antes de guardarse,
// y el lector avisa de todo lo que no pudo interpretar con certeza.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIGITOS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

async function extraer(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // pdf.js busca su "worker" por ruta en tiempo de ejecución, algo que el empaquetado de Vercel no
  // detecta. Importarlo de forma explícita lo incluye en la función y evita ese fallo.
  if (!globalThis.pdfjsWorker) globalThis.pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
  const { OPS } = pdfjs;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const alto = page.view[3];

  // Segmentos horizontales de la grilla (con la matriz de transformación acumulada).
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const pila = [];
  const horizontales = [];
  const punto = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], alto - (ctm[1] * x + ctm[3] * y + ctm[5])];
  const agregar = (p, q) => {
    if (Math.abs(p[1] - q[1]) < 0.3 && Math.abs(p[0] - q[0]) > 1) {
      horizontales.push({ y: (p[1] + q[1]) / 2, x0: Math.min(p[0], q[0]), x1: Math.max(p[0], q[0]) });
    }
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i];
    const a = ops.argsArray[i];
    if (f === OPS.save) pila.push(ctm);
    else if (f === OPS.restore) ctm = pila.pop() || ctm;
    else if (f === OPS.transform) ctm = mul(ctm, a);
    else if (f === OPS.constructPath) {
      const [sub, c] = a;
      let k = 0;
      let actual = null;
      for (const o of sub) {
        if (o === OPS.moveTo) { actual = punto(c[k], c[k + 1]); k += 2; }
        else if (o === OPS.lineTo) { const p = punto(c[k], c[k + 1]); k += 2; if (actual) agregar(actual, p); actual = p; }
        else if (o === OPS.rectangle) {
          const [x, y, w, h] = c.slice(k, k + 4); k += 4;
          const p = [punto(x, y), punto(x + w, y), punto(x + w, y + h), punto(x, y + h)];
          for (let j = 0; j < 4; j++) agregar(p[j], p[(j + 1) % 4]);
        } else if (o === OPS.curveTo) k += 6;
        else if (o === OPS.curveTo2 || o === OPS.curveTo3) k += 4;
      }
    }
  }

  const contenido = await page.getTextContent();
  const textos = contenido.items
    // El texto girado ("NACIONALES", "FERIADO", "PROV. BS. AS.") es decoración: se ignora.
    .filter((i) => i.str.trim() && Math.abs(i.transform[1]) < 0.01 && Math.abs(i.transform[2]) < 0.01)
    .map((i) => ({
      s: i.str.trim(),
      x: i.transform[4],
      w: i.width,
      xc: i.transform[4] + i.width / 2,
      y: alto - i.transform[5], // línea base, medida desde arriba
      h: i.height,
      yc: alto - i.transform[5] - i.height * 0.35, // centro vertical aproximado
    }));
  return { horizontales, textos, paginas: doc.numPages };
}

// Une los tramos de líneas en cada altura y se queda con los que cubren el ancho [xa, xb].
function separadores(horizontales, xa, xb) {
  const porY = new Map();
  for (const s of horizontales) {
    const clave = Math.round(s.y * 2) / 2;
    if (!porY.has(clave)) porY.set(clave, []);
    porY.get(clave).push(s);
  }
  return [...porY.entries()].map(([y, tramos]) => ({ y, tramos }))
    .map((s) => ({ ...s, cubre: (x) => s.tramos.some((t) => t.x0 - 1 <= x && t.x1 + 1 >= x) }))
    .filter((s) => s.cubre(xa) && s.cubre(xb))
    .sort((a, b) => a.y - b.y);
}

const quitarTildes = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');

// Texto de la obligación/concepto sin meses, años, fechas ni números de anticipo:
// sirve de identificador estable entre un mes y otro.
function claveEstable(texto) {
  return quitarTildes(texto)
    .toLowerCase()
    .replace(/\d{1,2}\/\d{1,2}\/\d{4}\s*al\s*\d{1,2}\/\d{1,2}\/\d{4}/g, ' ')
    .replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, ' ')
    .replace(new RegExp(`(${MESES.join('|')})\\s*[/ ]?\\s*\\d{4}`, 'g'), ' ')
    .replace(/\d{1,2}\/\d{4}/g, ' ')
    .replace(/\d+\s*[°º]/g, ' ')
    .replace(/\b\d{4}\b/g, ' ')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

function textoSinPeriodo(texto) {
  return texto
    .replace(/\d{1,2}\/\d{1,2}\/\d{4}\s*al\s*\d{1,2}\/\d{1,2}\/\d{4}/g, '')
    .replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, '')
    .replace(new RegExp(`(${MESES.join('|')})\\s*[/ ]?\\s*\\d{4}`, 'gi'), '')
    .replace(/\d{1,2}\/\d{4}/g, '')
    .replace(/\d+\s*[°º]/g, '')
    .replace(/\b\d{4}\b/g, '')
    .replace(/[\s\-:]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function leerCalendarioPdf(buffer) {
  const { horizontales, textos, paginas } = await extraer(buffer);
  const avisos = [];
  if (paginas > 1) avisos.push(`El PDF tiene ${paginas} páginas; solo se leyó la primera.`);

  // --- Mes y año ("Octubre 2026") ---
  const titulo = textos.find((t) => new RegExp(`^(${MESES.join('|')})\\s+\\d{4}$`, 'i').test(t.s) && t.y < 70);
  if (!titulo) throw new Error('No se encontró el mes del calendario. ¿Es el PDF "Calendario de vencimientos"?');
  const [nombreMes, anio] = titulo.s.toLowerCase().split(/\s+/);
  const mes = MESES.indexOf(nombreMes) + 1;
  const periodo = `${anio}-${String(mes).padStart(2, '0')}`;

  // --- Columnas de días: la fila de números más poblada ---
  const numeros = textos.filter((t) => /^\d{1,2}$/.test(t.s) && Number(t.s) >= 1 && Number(t.s) <= 31 && t.y < 100);
  const porAltura = new Map();
  for (const n of numeros) {
    const k = Math.round(n.y);
    porAltura.set(k, [...(porAltura.get(k) || []), n]);
  }
  const fila = [...porAltura.values()].sort((a, b) => b.length - a.length)[0];
  if (!fila || fila.length < 10) throw new Error('No se pudo leer la fila de días del calendario.');
  const columnas = fila.sort((a, b) => a.xc - b.xc).map((n) => ({ dia: Number(n.s), xc: n.xc }));
  const ancho = (columnas[columnas.length - 1].xc - columnas[0].xc) / (columnas.length - 1);
  const izqDatos = columnas[0].xc - ancho / 2;
  const derDatos = columnas[columnas.length - 1].xc + ancho / 2;
  const alturaEncabezado = fila[0].y;

  // --- Filas: separadores horizontales que cruzan toda la zona de fechas ---
  const seps = separadores(horizontales, columnas[0].xc, columnas[columnas.length - 1].xc)
    .filter((s) => s.y > alturaEncabezado);
  if (seps.length < 5) throw new Error('No se pudo reconocer la grilla del calendario.');
  const bandas = [];
  for (let i = 0; i < seps.length - 1; i++) {
    if (seps[i + 1].y - seps[i].y > 6) bandas.push({ top: seps[i].y, bottom: seps[i + 1].y });
  }
  // El pie ("Elaborado teniendo en cuenta...") queda debajo de la tabla.
  const pie = textos.find((t) => /^elaborado\b/i.test(t.s));
  if (pie) {
    while (bandas.length && bandas[bandas.length - 1].top >= pie.yc - 3) bandas.pop();
  }
  const finTabla = bandas[bandas.length - 1].bottom;
  const inicioTabla = bandas[0].top;

  // Celda que contiene un texto: tramos de línea que cubren su x, arriba y abajo de su y.
  const lineas = [...new Map(horizontales.map((s) => [Math.round(s.y * 2) / 2, true])).keys()];
  const celdaDe = (t) => {
    const cubren = lineas.filter((y) => horizontales.some((s) => Math.round(s.y * 2) / 2 === y && s.x0 - 1 <= t.xc && s.x1 + 1 >= t.xc));
    const arriba = Math.max(...cubren.filter((y) => y <= t.yc), -Infinity);
    const abajo = Math.min(...cubren.filter((y) => y > t.yc), Infinity);
    return { top: arriba, bottom: abajo };
  };

  const dentro = textos.filter((t) => t.yc > inicioTabla && t.yc < finTabla);
  const limiteConcepto = 157.5;
  const zonaObl = (t) => t.xc >= 45 && t.xc < limiteConcepto;
  const zonaCon = (t) => t.xc >= limiteConcepto && t.xc < izqDatos;
  const zonaNotas = (t) => t.xc >= derDatos + 5;
  const zonaDatos = (t) => t.xc >= izqDatos && t.xc < derDatos;

  const unir = (items) => items.sort((a, b) => Math.round(a.yc) - Math.round(b.yc) || a.x - b.x).map((t) => t.s).join(' ').replace(/\s+/g, ' ').trim();
  const textoDeCeldas = (filtro, banda) => {
    // Agrupa los textos de la zona por celda y devuelve los de las celdas que cubren la banda.
    const grupos = new Map();
    for (const t of dentro.filter(filtro)) {
      const c = celdaDe(t);
      if (c.top <= banda.top + 1 && c.bottom >= banda.bottom - 1) {
        const k = `${c.top}|${c.bottom}|${Math.round(t.x / 4)}`;
        grupos.set(k, [...(grupos.get(k) || []), t]);
      }
    }
    return [...grupos.values()].sort((a, b) => Math.min(...a.map((t) => t.x)) - Math.min(...b.map((t) => t.x))).map(unir);
  };

  const fechaDe = (dia) => `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const filas = [];
  let seccion = '';
  bandas.forEach((banda, idx) => {
    const tokens = dentro.filter((t) => zonaDatos(t) && t.yc >= banda.top && t.yc < banda.bottom);
    const obl = textoDeCeldas(zonaObl, banda).join(' ');
    const con = textoDeCeldas(zonaCon, banda).join(' ');
    const notas = unir(dentro.filter((t) => zonaNotas(t) && t.yc >= banda.top && t.yc < banda.bottom));

    if (!tokens.length) {
      // Fila de título de sección (ej. "INGRESOS BRUTOS") o fila sin fechas.
      const titulo = [obl, con].filter(Boolean).join(' ');
      if (titulo && titulo === titulo.toUpperCase()) seccion = titulo;
      else if (titulo) avisos.push(`La fila "${titulo}" no tiene fechas y se omitió.`);
      return;
    }

    const fechas = Object.fromEntries(DIGITOS.map((d) => [d, null]));
    for (const t of tokens) {
      const col = columnas.reduce((m, c) => (Math.abs(c.xc - t.xc) < Math.abs(m.xc - t.xc) ? c : m));
      if (Math.abs(col.xc - t.xc) > ancho * 0.55) { avisos.push(`Fila ${idx + 1}: "${t.s}" no coincide con ninguna columna.`); continue; }
      let digitos;
      if (/^todos$/i.test(t.s)) digitos = DIGITOS;
      else {
        const m = t.s.match(/^(\d)(?:\s*-\s*(\d))?$/);
        if (!m) { avisos.push(`Fila ${idx + 1}: no se entendió "${t.s}".`); continue; }
        const a = Number(m[1]);
        const b = m[2] === undefined ? a : Number(m[2]);
        digitos = DIGITOS.filter((d) => Number(d) >= Math.min(a, b) && Number(d) <= Math.max(a, b));
      }
      for (const d of digitos) {
        if (fechas[d] && fechas[d] !== fechaDe(col.dia)) avisos.push(`Fila ${idx + 1} (${con || obl}): la terminación ${d} aparece en dos fechas.`);
        fechas[d] = fechaDe(col.dia);
      }
    }
    const faltan = DIGITOS.filter((d) => !fechas[d]);
    if (faltan.length) avisos.push(`"${[obl, con].filter(Boolean).join(' – ')}": sin fecha para terminación ${faltan.join(', ')}.`);

    filas.push({ seccion, obligacion: obl, concepto: con, notas, fechas });
  });

  // Identificador estable (sin período) y nombre para mostrar; si dos filas coinciden se numeran.
  const usadas = new Map();
  for (const f of filas) {
    const base = claveEstable(`${f.obligacion} ${f.concepto}`);
    const n = (usadas.get(base) || 0) + 1;
    usadas.set(base, n);
    f.clave = n === 1 ? base : `${base} #${n}`;
    f.titulo = [f.obligacion, textoSinPeriodo(f.concepto)].filter(Boolean).join(' – ');
  }
  return { periodo, filas, avisos };
}

module.exports = { leerCalendarioPdf, claveEstable, textoSinPeriodo };
