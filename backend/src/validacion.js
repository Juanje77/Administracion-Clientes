const { z } = require('zod');

// Valida el CUIT/CUIL argentino (11 dígitos + dígito verificador).
function cuitValido(cuit) {
  const d = String(cuit).replace(/\D/g, '');
  if (d.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(d[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) return false;
  return dv === Number(d[10]);
}

const vacioANull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
const opcional = (schema) => z.preprocess(vacioANull, schema.nullable().optional());

const clienteSchema = z
  .object({
    razonSocial: z.string().trim().min(2, 'La razón social es obligatoria'),
    cuit: opcional(
      z.string().trim().refine(cuitValido, 'CUIT/CUIL inválido')
    ),
    email: opcional(z.string().trim().email('Email inválido')),
    telefono: opcional(
      z.string().trim().regex(/^[0-9+()\-\s]{6,20}$/, 'Teléfono inválido')
    ),
    direccion: opcional(z.string().trim()),
    ciudad: opcional(z.string().trim()),
    notas: opcional(z.string()),
    estado: z.enum(['ACTIVO', 'INACTIVO', 'POTENCIAL']).default('POTENCIAL'),
    tipoPersona: opcional(z.enum(['FISICA', 'JURIDICA'])),
    condicionIva: opcional(z.string().trim()),
    regimen: opcional(z.string().trim()),
    etiquetas: z.array(z.string().trim().min(1)).max(20).optional(),
    // Claves de las obligaciones del calendario impositivo que tiene este cliente.
    obligaciones: z.array(z.string().trim().min(1)).max(100).optional(),
    // Honorario mensual pactado (en pesos). Vacío = sin abono.
    // Recordatorios por email a este cliente (solo se envían si el administrador los activa en Avisos).
    recordatorios: z.boolean().optional(),
    // Personas que pueden ver este cliente (solo lo define un administrador).
    responsables: z.array(z.string().min(1)).max(100).optional(),
    abonoMensual: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(0).max(1e9).nullable()).optional(),
  })
  .superRefine((c, ctx) => {
    // Datos fiscales obligatorios solo para clientes activos.
    if (c.estado === 'ACTIVO') {
      for (const campo of ['cuit', 'condicionIva']) {
        if (!c[campo]) {
          ctx.addIssue({ code: 'custom', path: [campo], message: 'Obligatorio para clientes activos' });
        }
      }
    }
  });

const interaccionSchema = z.object({
  tipo: z.enum(['LLAMADA', 'REUNION', 'MENSAJE', 'NOTA']),
  fecha: z.coerce.date().optional(),
  detalle: z.string().trim().min(1, 'El detalle es obligatorio'),
});

const usuarioSchema = z.object({
  nombre: z.string().trim().min(2),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  rol: z.enum(['ADMIN', 'USUARIO']).default('USUARIO'),
  // Acceso a honorarios, cobros, deudas y montos (los administradores siempre lo tienen).
  verDinero: z.boolean().default(false),
  // 'ASIGNADOS': solo ve los clientes que se le asignen (por defecto en usuarios nuevos). 'TODOS': ve todos.
  accesoClientes: z.enum(['TODOS', 'ASIGNADOS']).default('ASIGNADOS'),
});

const usuarioCambiosSchema = z.object({ activo: z.boolean().optional(), verDinero: z.boolean().optional(), accesoClientes: z.enum(['TODOS', 'ASIGNADOS']).optional() })
  .refine((c) => Object.values(c).some((v) => v !== undefined), 'Nada para cambiar');

// Fecha "AAAA-MM-DD" que exista de verdad (rechaza 2026-02-31).
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; // mes 13, día 00, etc. dan fecha inválida (no un error)
  }, 'Fecha inválida');
const periodo = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período inválido (AAAA-MM)');

const tareaSchema = z.object({
  clienteId: opcional(z.string().min(1)), // vacío = tarea interna del estudio (sin cliente)
  titulo: z.string().trim().min(2, 'El título es obligatorio').max(200),
  descripcion: opcional(z.string().trim().max(2000)),
  vence: fecha,
  asignadoA: opcional(z.string().min(1)),
});
const tareaCambiosSchema = tareaSchema.partial().extend({ hecha: z.boolean().optional() });

const vencimientoSchema = z.object({
  clienteId: z.string().min(1, 'Elige un cliente'),
  impuesto: z.string().trim().min(2, 'El impuesto es obligatorio'),
  periodo,
  vence: fecha,
  notas: opcional(z.string().trim()),
});

const DIGITOS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const filaCalendarioSchema = z.object({
  seccion: z.string().trim().max(200).default(''),
  obligacion: z.string().trim().min(1, 'Falta la obligación').max(300),
  concepto: z.string().trim().max(500).default(''),
  notas: z.string().trim().max(2000).default(''),
  clave: z.string().trim().min(1).max(300),
  titulo: z.string().trim().min(1).max(500),
  // Fecha de vencimiento para cada último dígito del CUIT (null = no vence/no informado).
  fechas: z.object(Object.fromEntries(DIGITOS.map((d) => [d, fecha.nullable()]))),
});
const calendarioSchema = z.object({
  filas: z.array(filaCalendarioSchema).min(1, 'El calendario no tiene filas').max(300),
});

const monto = z.coerce.number({ message: 'Monto inválido' }).positive('El monto debe ser mayor a 0').max(1e9, 'Monto demasiado grande')
  .transform((n) => Math.round(n * 100) / 100);

const honorarioSchema = z.object({
  clienteId: z.string().min(1, 'Elige un cliente'),
  periodo,
  concepto: z.string().trim().min(2, 'El concepto es obligatorio').max(200),
  monto,
});
const honorarioCambiosSchema = z.object({
  concepto: z.string().trim().min(2).max(200).optional(),
  monto: monto.optional(),
});
const MEDIOS_PAGO = ['EFECTIVO', 'TRANSFERENCIA', 'CHEQUE', 'TARJETA', 'OTRO'];
const pagoSchema = z.object({
  monto,
  fecha: fecha.optional(),
  medio: z.enum(MEDIOS_PAGO).default('TRANSFERENCIA'),
  nota: opcional(z.string().trim().max(300)),
});

const CATEGORIAS_DOC = ['CONTRATO', 'PRESUPUESTO', 'FACTURA', 'CONSTANCIA', 'BALANCE', 'OTRO'];

const avisosConfigSchema = z.object({
  equipoActivo: z.boolean(),
  clientesDeuda: z.boolean(),
  clientesVencimientos: z.boolean(),
  diasEntreAvisosDeuda: z.coerce.number().int().min(1).max(90),
  diasAnticipoVencimiento: z.coerce.number().int().min(1).max(15),
  textoPago: z.string().trim().max(600).default(''),
});

const passwordSchema = z.object({
  actual: z.string().min(1, 'Ingresa tu contraseña actual'),
  nueva: z.string().min(8, 'Mínimo 8 caracteres'),
});

module.exports = {
  cuitValido, clienteSchema, interaccionSchema, usuarioSchema, usuarioCambiosSchema,
  tareaSchema, tareaCambiosSchema, vencimientoSchema, calendarioSchema, passwordSchema, periodo,
  honorarioSchema, honorarioCambiosSchema, pagoSchema, CATEGORIAS_DOC, avisosConfigSchema,
};
