// Plantillas de los emails. Todo texto que viene de la base (nombres de clientes, conceptos…)
// se escapa antes de entrar al HTML.
const dinero = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
const pesos = (n) => dinero.format(n);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (f) => f.split('-').reverse().join('/');

// Marca: azul marino, esquinas rectas, sin sombras. Los clientes de correo no cargan fuentes propias, así que se piden
// Barlow / Arial Narrow con alternativas; el monograma solo se muestra si APP_URL es una dirección pública (https).
const AZUL = '#0c284b';
const TINTA = '#14202e';
const TENUE = '#5b6d84';
const LINEA = '#cfd6e0';
const ROJO = '#a33a2f';
const OCRE = '#8a6212';
const TITULOS = "'Barlow Condensed','Arial Narrow',Arial,sans-serif";

function logo() {
  const base = (process.env.APP_URL || '').replace(/\/$/, '');
  return /^https:\/\//.test(base) ? `<img src="${esc(base)}/logo-1.png" width="40" height="40" alt="" style="vertical-align:middle;margin-right:12px;border:0">` : '';
}

const MARCO = (titulo, cuerpo, pie) => `<!doctype html><html lang="es"><body style="margin:0;background:#f4f5f7;font-family:Barlow,Helvetica,Arial,sans-serif;color:${TINTA}">
<div style="max-width:600px;margin:0 auto;padding:16px">
<div style="background:${AZUL};padding:16px 24px;color:#ffffff">${logo()}<span style="font-family:${TITULOS};font-size:20px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;vertical-align:middle">${esc(process.env.ESTUDIO_NOMBRE || 'Estudio Contable')}</span></div>
<div style="background:#ffffff;border:1px solid ${LINEA};border-top:0;padding:24px">
<h1 style="font-family:${TITULOS};font-size:26px;font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin:0 0 16px;color:${AZUL}">${esc(titulo)}</h1>${cuerpo}</div>
<p style="font-size:12px;color:${TENUE};margin:12px 4px">${pie}</p></div></body></html>`;

const seccion = (titulo, color, filas) => (filas.length ? `<h2 style="font-size:14px;margin:16px 0 6px;color:${color}">${esc(titulo)}</h2>
<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.5">${filas.map((f) => `<li>${f}</li>`).join('')}</ul>` : '');
const lista = (filas) => filas.map((f) => `  - ${f.texto}`).join('\n');
const boton = (url, texto) => (url ? `<p style="margin:20px 0 4px"><a href="${esc(url)}" style="background:${AZUL};color:#ffffff;text-decoration:none;padding:12px 28px;font-size:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;display:inline-block">${esc(texto)}</a></p>` : '');

// Resumen interno para un integrante del equipo.
// datos: { tareas: {vencidas, hoy, proximas: [{titulo, clienteNombre, vence}]}, vencimientos: {vencidos, hoy, proximos: [{texto}]}, deudores?: {total, top: [...]}}
function resumenEquipo({ nombre, estudio, url, tareas, vencimientos, deudores }) {
  const t = (x) => `${esc(x.titulo)} <span style="color:${TENUE}">· ${esc(x.clienteNombre)} · ${fecha(x.vence)}</span>`;
  const v = (x) => esc(x.texto);
  const bloques = [
    seccion('Tareas vencidas', ROJO, tareas.vencidas.map(t)),
    seccion('Tareas para hoy', OCRE, tareas.hoy.map(t)),
    seccion('Tareas de los próximos días', TENUE, tareas.proximas.map(t)),
    seccion('Vencimientos impositivos vencidos', ROJO, vencimientos.vencidos.map(v)),
    seccion('Vencen hoy', OCRE, vencimientos.hoy.map(v)),
    seccion('Vencen en los próximos días', TENUE, vencimientos.proximos.map(v)),
  ];
  if (deudores && deudores.top.length) {
    bloques.push(seccion(`Clientes con deuda · total ${pesos(deudores.total)}`, AZUL,
      deudores.top.map((d) => `${esc(d.clienteNombre)} <span style="color:${TENUE}">· ${d.cantidad} ${d.cantidad === 1 ? 'período' : 'períodos'}</span> · <strong>${pesos(d.saldo)}</strong>`)));
  }
  const html = MARCO(`Buen día${nombre ? `, ${nombre.split(' ')[0]}` : ''}: resumen del día`, bloques.join('') + boton(url && `${url}/agenda`, 'Abrir la agenda'),
    `Aviso automático de ${esc(estudio)}. Puedes desactivarlo en <em>Mi cuenta</em>.`);
  const texto = [
    `Resumen del día - ${estudio}`,
    tareas.vencidas.length ? `\nTAREAS VENCIDAS\n${lista(tareas.vencidas.map((x) => ({ texto: `${x.titulo} (${x.clienteNombre}, ${fecha(x.vence)})` })))}` : '',
    tareas.hoy.length ? `\nTAREAS PARA HOY\n${lista(tareas.hoy.map((x) => ({ texto: `${x.titulo} (${x.clienteNombre})` })))}` : '',
    tareas.proximas.length ? `\nTAREAS PROXIMAS\n${lista(tareas.proximas.map((x) => ({ texto: `${x.titulo} (${x.clienteNombre}, ${fecha(x.vence)})` })))}` : '',
    vencimientos.vencidos.length ? `\nVENCIMIENTOS VENCIDOS\n${lista(vencimientos.vencidos)}` : '',
    vencimientos.hoy.length ? `\nVENCEN HOY\n${lista(vencimientos.hoy)}` : '',
    vencimientos.proximos.length ? `\nVENCEN PRONTO\n${lista(vencimientos.proximos)}` : '',
    deudores?.top.length ? `\nDEUDA TOTAL: ${pesos(deudores.total)}\n${lista(deudores.top.map((d) => ({ texto: `${d.clienteNombre}: ${pesos(d.saldo)}` })))}` : '',
    url ? `\n${url}/agenda` : '',
  ].filter(Boolean).join('\n');
  return { html, text: texto };
}

const PIE_TEXTO = (estudio) => `Este es un aviso automático de ${estudio}. Si ya lo regularizó, ignore este mensaje. Si no desea recibir más avisos, responda a este correo y lo daremos de baja.`;
const PIE_CLIENTE = (estudio) => `Este es un aviso automático de ${esc(estudio)}. Si ya lo regularizó, ignore este mensaje. Si no desea recibir más avisos, responda a este correo y lo daremos de baja.`;

// Recordatorio de honorarios pendientes al cliente.
function recordatorioDeuda({ cliente, estudio, items, total, textoPago }) {
  const filas = items.map((h) => `${esc(h.concepto)} <span style="color:${TENUE}">· ${esc(h.periodo)}</span> · <strong>${pesos(h.saldo)}</strong>`);
  const html = MARCO(`Honorarios pendientes`, `<p style="font-size:14px">Hola ${esc(cliente)}, te recordamos que figuran honorarios pendientes de pago:</p>
${seccion('Detalle', AZUL, filas)}<p style="font-size:15px;margin:14px 0 0"><strong>Total adeudado: ${pesos(total)}</strong></p>
${textoPago ? `<p style="font-size:14px;margin:14px 0 0;white-space:pre-line">${esc(textoPago)}</p>` : ''}`, PIE_CLIENTE(estudio));
  const text = [`Hola ${cliente},`, 'te recordamos que figuran honorarios pendientes de pago:', ...items.map((h) => `  - ${h.concepto} (${h.periodo}): ${pesos(h.saldo)}`),
    `Total adeudado: ${pesos(total)}`, textoPago || '', `\n${estudio}`, `\n${PIE_TEXTO(estudio)}`].filter((l) => l !== '').join('\n');
  return { html, text, subject: `Honorarios pendientes - ${estudio}` };
}

// Recordatorio de vencimientos impositivos próximos.
function recordatorioVencimientos({ cliente, estudio, items }) {
  const filas = items.map((v) => `${esc(v.impuesto)} <span style="color:${TENUE}">·</span> <strong>vence el ${fecha(v.vence)}</strong>${v.dias === 0 ? ' (hoy)' : v.dias === 1 ? ' (mañana)' : ` (en ${v.dias} días)`}`);
  const html = MARCO('Vencimientos próximos', `<p style="font-size:14px">Hola ${esc(cliente)}, te avisamos de los próximos vencimientos impositivos:</p>${seccion('Detalle', AZUL, filas)}`, PIE_CLIENTE(estudio));
  const text = [`Hola ${cliente},`, 'te avisamos de los próximos vencimientos impositivos:', ...items.map((v) => `  - ${v.impuesto}: vence el ${fecha(v.vence)}`), `\n${estudio}`, `\n${PIE_TEXTO(estudio)}`].join('\n');
  return { html, text, subject: `Vencimientos próximos - ${estudio}` };
}

// Aviso a quien recibe una tarea asignada.
function tareaAsignada({ nombre, quien, titulo, cliente, vence, descripcion, estudio, url }) {
  const filas = [
    ['Tarea', esc(titulo)],
    ['Cliente', cliente ? esc(cliente) : 'Tarea interna del estudio'],
    ['Vence', fecha(vence)],
    ...(descripcion ? [['Detalle', `<span style="white-space:pre-line">${esc(descripcion)}</span>`]] : []),
  ].map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:${TENUE};vertical-align:top">${k}</td><td style="padding:4px 0"><strong>${v}</strong></td></tr>`).join('');
  const html = MARCO(`${esc(quien)} te asignó una tarea`, `<p style="font-size:14px;margin:0 0 8px">Hola ${esc((nombre || '').split(' ')[0])},</p>
<table style="font-size:14px;border-collapse:collapse">${filas}</table>${boton(url && `${url}/agenda`, 'Ver mi agenda')}`,
    `Aviso automático de ${esc(estudio)}. Puedes desactivar los avisos en <em>Mi cuenta</em>.`);
  const text = [`Hola ${(nombre || '').split(' ')[0]},`, `${quien} te asignó una tarea:`, `  Tarea: ${titulo}`, `  Cliente: ${cliente || 'Tarea interna del estudio'}`,
    `  Vence: ${fecha(vence)}`, descripcion ? `  Detalle: ${descripcion}` : '', url ? `\n${url}/agenda` : ''].filter(Boolean).join('\n');
  return { html, text, subject: `Nueva tarea: ${titulo}` };
}

function prueba({ estudio }) {
  return {
    subject: `Prueba de correo - ${estudio}`,
    html: MARCO('Prueba de correo', '<p style="font-size:14px">Si estás leyendo esto, el envío de avisos por email funciona correctamente. ✔</p>', `Mensaje de prueba de ${esc(estudio)}.`),
    text: 'Si estás leyendo esto, el envío de avisos por email funciona correctamente.',
  };
}

module.exports = { resumenEquipo, recordatorioDeuda, recordatorioVencimientos, tareaAsignada, prueba, esc, pesos, fecha };
