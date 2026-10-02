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
});

// Fecha "AAAA-MM-DD" que exista de verdad (rechaza 2026-02-31).
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)')
  .refine((s) => new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, 'Fecha inválida');
const periodo = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período inválido (AAAA-MM)');

const tareaSchema = z.object({
  clienteId: z.string().min(1, 'Elige un cliente'),
  titulo: z.string().trim().min(2, 'El título es obligatorio'),
  descripcion: opcional(z.string().trim()),
  vence: fecha,
  asignadoA: opcional(z.string().min(1)),
});
const tareaCambiosSchema = tareaSchema
  .omit({ clienteId: true })
  .partial()
  .extend({ hecha: z.boolean().optional() });

const vencimientoSchema = z.object({
  clienteId: z.string().min(1, 'Elige un cliente'),
  impuesto: z.string().trim().min(2, 'El impuesto es obligatorio'),
  periodo,
  vence: fecha,
  notas: opcional(z.string().trim()),
});

// Grupos de terminación de CUIT usados por el calendario impositivo.
const GRUPOS_CUIT = ['0-1', '2-3', '4-5', '6-7', '8-9'];
const generarSchema = z.object({
  impuesto: z.string().trim().min(2, 'El impuesto es obligatorio'),
  periodo,
  fechas: z
    .partialRecord(z.enum(GRUPOS_CUIT), fecha)
    .refine((f) => Object.keys(f).length > 0, 'Indica al menos una fecha'),
  etiqueta: opcional(z.string().trim()),
  incluirInactivos: z.boolean().default(false),
});

const passwordSchema = z.object({
  actual: z.string().min(1, 'Ingresa tu contraseña actual'),
  nueva: z.string().min(8, 'Mínimo 8 caracteres'),
});

module.exports = {
  cuitValido, clienteSchema, interaccionSchema, usuarioSchema,
  tareaSchema, tareaCambiosSchema, vencimientoSchema, generarSchema, passwordSchema, GRUPOS_CUIT,
};
