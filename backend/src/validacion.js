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

module.exports = { cuitValido, clienteSchema, interaccionSchema, usuarioSchema };
