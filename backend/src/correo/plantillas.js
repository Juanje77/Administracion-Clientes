// Plantillas de los emails. Todo texto que viene de la base (nombres de clientes, conceptos…)
// se escapa antes de entrar al HTML.
const dinero = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
const pesos = (n) => dinero.format(n);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fecha = (f) => f.split('-').reverse().join('/');

const MARCO = (titulo, cuerpo, pie) => `<!doctype html><html lang="es"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b">
<div style="max-width:600px;margin:0 auto;padding:16px"><div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px">
<h1 style="font-size:18px;margin:0 0 12px">${esc(titulo)}</h1>${cuerpo}</div>
<p style="font-size:12px;color:#64748b;margin:12px 4px">${pie}</p></div></body></html>`;

const seccion = (titulo, color, filas) => (filas.length ? `<h2 style="font-size:14px;margin:16px 0 6px;color:${color}">${esc(titulo)}</h2>
<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.5">${filas.map((f) => `<li>${f}</li>`).join('')}</ul>` : '');
const lista = (filas) => filas.map((f) => `  - ${f.texto}`).join('\n');
const boton = (url, texto) => (url ? `<p style="margin:20px 0 4px"><a href="${esc(url)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:9px 16px;border-radius:6px;font-size:14px">${esc(texto)}</a></p>` : '');

// Resumen interno para un integrante del equipo.
// datos: { tareas: {vencidas, hoy, proximas: [{titulo, clienteNombre, vence}]}, vencimientos: {vencidos, hoy, proximos: [{texto}]}, deudores?: {total, top: [...]}}
function resumenEquipo({ nombre, estudio, url, tareas, vencimientos, deudores }) {
  const t = (x) => `${esc(x.titulo)} <span style="color:#64748b">· ${esc(x.clienteNombre)} · ${fecha(x.vence)}</span>`;
  const v = (x) => esc(x.texto);
  const bloques = [
    seccion('Tareas vencidas', '#dc2626', tareas.vencidas.map(t)),
    seccion('Tareas para hoy', '#ea580c', tareas.hoy.map(t)),
    seccion('Tareas de los próximos días', '#475569', tareas.proximas.map(t)),
    seccion('Vencimientos impositivos vencidos', '#dc2626', vencimientos.vencidos.map(v)),
    seccion('Vencen hoy', '#ea580c', vencimientos.hoy.map(v)),
    seccion('Vencen en los próximos días', '#475569', vencimientos.proximos.map(v)),
  ];
  if (deudores && deudores.top.length) {
    bloques.push(seccion(`Clientes con deuda · total ${pesos(deudores.total)}`, '#dc2626',
      deudores.top.map((d) => `${esc(d.clienteNombre)} <span style="color:#64748b">· ${d.cantidad} ${d.cantidad === 1 ? 'período' : 'períodos'}</span> · <strong>${pesos(d.saldo)}</strong>`)));
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
  const filas = items.map((h) => `${esc(h.concepto)} <span style="color:#64748b">· ${esc(h.periodo)}</span> · <strong>${pesos(h.saldo)}</strong>`);
  const html = MARCO(`Honorarios pendientes`, `<p style="font-size:14px">Hola ${esc(cliente)}, te recordamos que figuran honorarios pendientes de pago:</p>
${seccion('Detalle', '#1e293b', filas)}<p style="font-size:15px;margin:14px 0 0"><strong>Total adeudado: ${pesos(total)}</strong></p>
${textoPago ? `<p style="font-size:14px;margin:14px 0 0;white-space:pre-line">${esc(textoPago)}</p>` : ''}`, PIE_CLIENTE(estudio));
  const text = [`Hola ${cliente},`, 'te recordamos que figuran honorarios pendientes de pago:', ...items.map((h) => `  - ${h.concepto} (${h.periodo}): ${pesos(h.saldo)}`),
    `Total adeudado: ${pesos(total)}`, textoPago || '', `\n${estudio}`, `\n${PIE_TEXTO(estudio)}`].filter((l) => l !== '').join('\n');
  return { html, text, subject: `Honorarios pendientes - ${estudio}` };
}

// Recordatorio de vencimientos impositivos próximos.
function recordatorioVencimientos({ cliente, estudio, items }) {
  const filas = items.map((v) => `${esc(v.impuesto)} <span style="color:#64748b">·</span> <strong>vence el ${fecha(v.vence)}</strong>${v.dias === 0 ? ' (hoy)' : v.dias === 1 ? ' (mañana)' : ` (en ${v.dias} días)`}`);
  const html = MARCO('Vencimientos próximos', `<p style="font-size:14px">Hola ${esc(cliente)}, te avisamos de los próximos vencimientos impositivos:</p>${seccion('Detalle', '#1e293b', filas)}`, PIE_CLIENTE(estudio));
  const text = [`Hola ${cliente},`, 'te avisamos de los próximos vencimientos impositivos:', ...items.map((v) => `  - ${v.impuesto}: vence el ${fecha(v.vence)}`), `\n${estudio}`, `\n${PIE_TEXTO(estudio)}`].join('\n');
  return { html, text, subject: `Vencimientos próximos - ${estudio}` };
}

function prueba({ estudio }) {
  return {
    subject: `Prueba de correo - ${estudio}`,
    html: MARCO('Prueba de correo', '<p style="font-size:14px">Si estás leyendo esto, el envío de avisos por email funciona correctamente. ✔</p>', `Mensaje de prueba de ${esc(estudio)}.`),
    text: 'Si estás leyendo esto, el envío de avisos por email funciona correctamente.',
  };
}

module.exports = { resumenEquipo, recordatorioDeuda, recordatorioVencimientos, prueba, esc, pesos, fecha };
