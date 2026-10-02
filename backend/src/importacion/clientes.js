// Convierte las filas de una planilla en clientes: detecta columnas, normaliza y valida cada fila
// y avisa de lo dudoso. Un dato dudoso NO frena la importación (el cliente entra y queda marcado
// para revisar); solo se rechaza una fila si no tiene nombre o si el cliente ya existe.
const { z } = require('zod');
const { cuitValido } = require('../validacion');

const CAMPOS = {
  razonSocial: { titulo: 'Nombre / Razón social', sinonimos: ['razon social', 'nombre', 'nombre y apellido', 'apellido y nombre', 'cliente', 'denominacion', 'nombre razon social', 'nombre apellido'] },
  cuit: { titulo: 'CUIT / CUIL / DNI', sinonimos: ['cuit', 'cuil', 'cuit cuil', 'cuit dni', 'dni cuit', 'dni', 'documento', 'nro documento', 'cuit cuil dni', 'nro cuit'] },
  email: { titulo: 'Email', sinonimos: ['email', 'e mail', 'mail', 'correo', 'correo electronico'] },
  telefono: { titulo: 'Teléfono', sinonimos: ['telefono', 'tel', 'celular', 'movil', 'whatsapp', 'telefono celular', 'cel'] },
  direccion: { titulo: 'Dirección', sinonimos: ['direccion', 'domicilio', 'calle'] },
  ciudad: { titulo: 'Ciudad', sinonimos: ['ciudad', 'localidad', 'poblacion'] },
  estado: { titulo: 'Estado', sinonimos: ['estado', 'situacion'] },
  tipoPersona: { titulo: 'Tipo de persona', sinonimos: ['tipo persona', 'tipo de persona', 'persona'] },
  condicionIva: { titulo: 'Condición IVA', sinonimos: ['condicion iva', 'condicion frente al iva', 'iva', 'condicion', 'situacion iva', 'cond iva'] },
  regimen: { titulo: 'Régimen', sinonimos: ['regimen'] },
  notas: { titulo: 'Notas', sinonimos: ['notas', 'observaciones', 'comentarios', 'obs', 'observacion'] },
  etiquetas: { titulo: 'Etiquetas', sinonimos: ['etiquetas', 'tags', 'categoria', 'categorias'] },
};

const plano = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();

// Elige la fila de encabezados: la primera con al menos un nombre de columna conocido.
function detectarEncabezados(filas) {
  const conocidos = new Set(Object.values(CAMPOS).flatMap((c) => c.sinonimos));
  const idx = filas.findIndex((f) => f.celdas.some((c) => conocidos.has(plano(c))));
  return idx === -1 ? 0 : idx;
}

function detectarMapeo(encabezados) {
  const mapeo = {};
  const usados = new Set();
  encabezados.forEach((enc, i) => {
    const t = plano(enc);
    if (!t) return;
    const campo = Object.keys(CAMPOS).find((k) => !usados.has(k) && CAMPOS[k].sinonimos.includes(t))
      ?? Object.keys(CAMPOS).find((k) => !usados.has(k) && CAMPOS[k].sinonimos.some((s) => s.length > 4 && t.includes(s)));
    if (campo) { mapeo[i] = campo; usados.add(campo); }
  });
  return mapeo;
}

const CONDICIONES = [
  [/^(ri|resp\w*\.? inscripto|responsable inscripto|inscripto)$/, 'Responsable Inscripto'],
  [/^(mt|monotributo|monotributista|monotributo social|mono)$/, 'Monotributista'],
  [/^(exento|iva exento)$/, 'Exento'],
  [/^(cf|consumidor final)$/, 'Consumidor Final'],
  [/^(no resp\w*|no responsable|rni)$/, 'No Responsable'],
];
const condicionIva = (v) => CONDICIONES.find(([re]) => re.test(plano(v)))?.[1] ?? null;

const estadoDe = (v) => {
  const t = plano(v);
  if (!t) return null;
  if (/^(activo|a|si|vigente|alta)$/.test(t)) return 'ACTIVO';
  if (/^(inactivo|i|no|baja|archivado)$/.test(t)) return 'INACTIVO';
  if (/^(potencial|prospecto|p|posible)$/.test(t)) return 'POTENCIAL';
  return undefined; // texto que no se entiende
};

const personaDe = (v) => {
  const t = plano(v);
  if (/^(fisica|persona fisica|pf|humana|persona humana)$/.test(t)) return 'FISICA';
  if (/^(juridica|persona juridica|pj|sociedad|empresa)$/.test(t)) return 'JURIDICA';
  return null;
};
const personaPorCuit = (cuit) => (!cuit ? null : ['30', '33', '34'].includes(cuit.slice(0, 2)) ? 'JURIDICA' : ['20', '23', '24', '27'].includes(cuit.slice(0, 2)) ? 'FISICA' : null);

const formatearCuit = (d) => `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
const email = z.string().email();

// Una fila ya mapeada -> { datos, advertencias, rechazo? }
function normalizarFila(v) {
  const advertencias = [];
  const notas = [];
  const razonSocial = (v.razonSocial || '').replace(/\s+/g, ' ').trim();
  if (razonSocial.length < 2) return { rechazo: 'Falta el nombre o razón social', advertencias };

  let cuit = null;
  if (v.cuit) {
    const digitos = v.cuit.replace(/\D/g, '');
    if (digitos.length === 11 && cuitValido(digitos)) cuit = formatearCuit(digitos);
    else if (digitos.length === 11) { advertencias.push(`CUIT inválido (${v.cuit}): se importó sin CUIT`); notas.push(`CUIT en la planilla (inválido): ${v.cuit}`); }
    else if (digitos.length >= 7 && digitos.length <= 8) notas.push(`DNI: ${digitos}`);
    else { advertencias.push(`CUIT/DNI no reconocido (${v.cuit}): se importó sin CUIT`); notas.push(`CUIT/DNI en la planilla: ${v.cuit}`); }
  }

  let mail = null;
  if (v.email) {
    const m = v.email.trim().toLowerCase();
    if (email.safeParse(m).success) mail = m;
    else { advertencias.push(`Email inválido (${v.email}): se omitió`); notas.push(`Email en la planilla: ${v.email}`); }
  }
  let telefono = null;
  if (v.telefono) {
    if (/^[0-9+()\-\s.]{6,20}$/.test(v.telefono)) telefono = v.telefono.replace(/\./g, '');
    else { advertencias.push(`Teléfono no reconocido (${v.telefono}): se omitió`); notas.push(`Teléfono en la planilla: ${v.telefono}`); }
  }

  let iva = null;
  if (v.condicionIva) {
    iva = condicionIva(v.condicionIva);
    if (!iva) { advertencias.push(`Condición IVA no reconocida (${v.condicionIva}): se omitió`); notas.push(`Condición IVA en la planilla: ${v.condicionIva}`); }
  }

  let estado = estadoDe(v.estado);
  if (estado === undefined) { advertencias.push(`Estado no reconocido (${v.estado}): se calculó automáticamente`); estado = null; }
  if (!estado) {
    // Sin estado: Activo si tiene los datos fiscales; si no, Potencial.
    estado = cuit && iva ? 'ACTIVO' : 'POTENCIAL';
    if (estado === 'POTENCIAL') advertencias.push('Se importó como Potencial porque faltan CUIT o condición IVA');
  } else if (estado === 'ACTIVO' && !(cuit && iva)) {
    advertencias.push('Activo sin CUIT o condición IVA: completar para generar sus vencimientos');
  }

  const etiquetas = [...new Set((v.etiquetas || '').split(/[,;|]/).map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  if (v.notas) notas.unshift(v.notas);

  return {
    advertencias,
    datos: {
      razonSocial, cuit, email: mail, telefono,
      direccion: v.direccion || null, ciudad: v.ciudad || null,
      notas: notas.join('\n') || null,
      estado, tipoPersona: personaDe(v.tipoPersona) ?? personaPorCuit(cuit),
      condicionIva: iva, regimen: v.regimen || null, etiquetas,
    },
  };
}

// Procesa toda la planilla. `existentes` son los clientes ya cargados (para detectar duplicados).
function procesar(filas, mapeoManual, existentes) {
  const iEnc = detectarEncabezados(filas);
  const encabezados = filas[iEnc].celdas;
  const mapeo = mapeoManual ?? detectarMapeo(encabezados);
  const cuitsUsados = new Map(existentes.filter((c) => c.cuit).map((c) => [c.cuit.replace(/\D/g, ''), c.razonSocial]));
  const nombresUsados = new Map(existentes.map((c) => [plano(c.razonSocial), c.razonSocial]));

  const resultado = filas.slice(iEnc + 1).map((f) => {
    const valores = {};
    for (const [i, campo] of Object.entries(mapeo)) if (campo) valores[campo] = (f.celdas[i] ?? '').trim();
    const r = normalizarFila(valores);
    if (!r.rechazo) {
      const clave = r.datos.cuit?.replace(/\D/g, '');
      const nombre = plano(r.datos.razonSocial);
      if (clave && cuitsUsados.has(clave)) r.rechazo = `Ya existe un cliente con ese CUIT (${cuitsUsados.get(clave)})`;
      else if (!clave && nombresUsados.has(nombre)) r.rechazo = 'Ya existe un cliente con el mismo nombre';
      else {
        if (clave) cuitsUsados.set(clave, r.datos.razonSocial);
        nombresUsados.set(nombre, r.datos.razonSocial);
      }
    }
    return {
      n: f.n,
      nombre: valores.razonSocial || '',
      estado: r.rechazo ? 'RECHAZADA' : r.advertencias.length ? 'ADVERTENCIA' : 'OK',
      motivo: r.rechazo || null,
      advertencias: r.advertencias,
      datos: r.rechazo ? null : r.datos,
    };
  });

  const cuenta = (e) => resultado.filter((x) => x.estado === e).length;
  return {
    encabezados,
    mapeo,
    campos: Object.fromEntries(Object.entries(CAMPOS).map(([k, c]) => [k, c.titulo])),
    resumen: { total: resultado.length, ok: cuenta('OK'), advertencias: cuenta('ADVERTENCIA'), rechazadas: cuenta('RECHAZADA') },
    filas: resultado,
  };
}

const ENCABEZADOS_PLANTILLA = ['Nombre / Razón social', 'CUIT', 'Email', 'Teléfono', 'Dirección', 'Ciudad', 'Estado', 'Tipo de persona', 'Condición IVA', 'Régimen', 'Etiquetas', 'Notas'];
const EJEMPLO_PLANTILLA = ['Pérez Hnos. SRL', '30-12345678-1', 'contacto@perez.com', '2954 123456', 'Av. San Martín 123', 'Santa Rosa', 'Activo', 'Jurídica', 'Responsable Inscripto', 'Ganancias, IIBB', 'mensual, sueldos', 'Cliente desde 2019'];

module.exports = { procesar, detectarEncabezados, detectarMapeo, CAMPOS, ENCABEZADOS_PLANTILLA, EJEMPLO_PLANTILLA };
