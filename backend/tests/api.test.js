const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const { db } = require('../src/db');
const { invalidar } = require('../src/cache');
const { cuitValido } = require('../src/validacion');

let admin, user;

async function login(email, password = 'clave12345') {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return agent;
}

beforeAll(async () => {
  for (const c of ['clientes', 'cuits', 'usuarios']) await db.recursiveDelete(db.collection(c));
  invalidar();
  const passwordHash = await bcrypt.hash('clave12345', 4);
  await db.collection('usuarios').add({ nombre: 'Admin', email: 'admin@t.com', passwordHash, rol: 'ADMIN', activo: true });
  await db.collection('usuarios').add({ nombre: 'Ana', email: 'ana@t.com', passwordHash, rol: 'USUARIO', activo: true });
  admin = await login('admin@t.com');
  user = await login('ana@t.com');
});

describe('CUIT', () => {
  it('valida dígito verificador', () => {
    expect(cuitValido('20-12345678-6')).toBe(true);
    expect(cuitValido('20-12345678-5')).toBe(false);
    expect(cuitValido('123')).toBe(false);
  });
});

describe('autenticación', () => {
  it('rechaza sin sesión y con clave incorrecta', async () => {
    await request(app).get('/api/clientes').expect(401);
    await request(app).post('/api/auth/login').send({ email: 'admin@t.com', password: 'mala' }).expect(401);
  });
  it('solo admin gestiona usuarios', async () => {
    await user.get('/api/usuarios').expect(403);
    await admin.post('/api/usuarios').send({ nombre: 'Luis', email: 'luis@t.com', password: 'clave12345' }).expect(201);
    await admin.post('/api/usuarios').send({ nombre: 'Luis', email: 'luis@t.com', password: 'clave12345' }).expect(409);
  });
});

describe('clientes', () => {
  let id;
  it('crea con validación y detecta duplicados', async () => {
    await user.post('/api/clientes').send({ razonSocial: 'X', email: 'no-es-email' }).expect(400);
    const r = await user
      .post('/api/clientes')
      .send({ razonSocial: 'Pérez SRL', cuit: '20-12345678-6', condicionIva: 'Responsable Inscripto',
        estado: 'ACTIVO', ciudad: 'Santa Rosa', email: 'perez@x.com', telefono: '2954-123456', etiquetas: ['Monotributo'] })
      .expect(201);
    id = r.body.id;
    expect(r.body.etiquetas[0].nombre).toBe('monotributo');
    await user.post('/api/clientes').send({ razonSocial: 'Otro', cuit: '20-12345678-6' }).expect(409);
  });
  it('exige datos fiscales a clientes activos', async () => {
    await user.post('/api/clientes').send({ razonSocial: 'Sin CUIT', estado: 'ACTIVO' }).expect(400);
    await user.post('/api/clientes').send({ razonSocial: 'Potencial Uno', ciudad: 'General Pico' }).expect(201);
  });
  it('busca, filtra y ordena', async () => {
    const q = await user.get('/api/clientes?q=perez').expect(200);
    expect(q.body.total).toBe(1);
    expect((await user.get('/api/clientes?estado=POTENCIAL').expect(200)).body.total).toBe(1);
    expect((await user.get('/api/clientes?ciudad=santa rosa').expect(200)).body.total).toBe(1);
    expect((await user.get('/api/clientes?etiqueta=Monotributo').expect(200)).body.total).toBe(1);
    const o = await user.get('/api/clientes?orden=razonSocial&dir=desc').expect(200);
    expect(o.body.datos[0].razonSocial).toBe('Potencial Uno');
    // Entrada maliciosa no rompe la consulta
    await user.get(`/api/clientes?q=${encodeURIComponent("'; DROP TABLE \"Cliente\";--")}&orden=hack`).expect(200);
    // La búsqueda ignora tildes y mayúsculas
    expect((await user.get('/api/clientes?q=PEREZ').expect(200)).body.total).toBe(1);
  });
  it('actualiza y registra interacciones', async () => {
    const u = await user.put(`/api/clientes/${id}`).send({ razonSocial: 'Pérez SA', cuit: '20-12345678-6',
      condicionIva: 'RI', estado: 'ACTIVO', etiquetas: [] }).expect(200);
    expect(u.body.razonSocial).toBe('Pérez SA');
    const i = await user.post(`/api/clientes/${id}/interacciones`).send({ tipo: 'LLAMADA', detalle: 'Consulta IVA' }).expect(201);
    expect((await user.get(`/api/clientes/${id}/interacciones`)).body).toHaveLength(1);
    await admin.delete(`/api/clientes/${id}/interacciones/${i.body.id}`).expect(204);
  });
  it('archiva por defecto y borra definitivo solo admin', async () => {
    expect((await user.delete(`/api/clientes/${id}`).expect(200)).body.estado).toBe('INACTIVO');
    await user.delete(`/api/clientes/${id}?definitivo=true`).expect(403);
    await admin.delete(`/api/clientes/${id}?definitivo=true`).expect(204);
    await user.get(`/api/clientes/${id}`).expect(404);
    // El CUIT queda libre al borrar
    await user.post('/api/clientes').send({ razonSocial: 'Reusa CUIT', cuit: '20-12345678-6' }).expect(201);
  });
});

// ---------- Etapa 2 ----------
const { hoy, sumarDias } = require('../src/util');

// Arma un CUIT válido a partir de 10 dígitos calculando el verificador.
function cuitDe(base10) {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((a, p, i) => a + p * Number(base10[i]), 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  return dv === 10 ? null : base10 + dv;
}

describe('tareas, vencimientos y alertas', () => {
  const ids = {};
  beforeAll(async () => {
    // Clientes activos con distinta terminación de CUIT (busca bases que den cada grupo).
    const usados = new Set();
    for (const [grupo, nombre] of [['0-1', 'Cliente A'], ['2-3', 'Cliente B'], ['6-7', 'Cliente C']]) {
      for (let n = 1000000000; ; n += 7) {
        const c = cuitDe(String(n).padStart(10, '0').replace(/^1/, '2'));
        if (!c || usados.has(c)) continue;
        const d = Number(c[10]);
        if (`${d - (d % 2)}-${d - (d % 2) + 1}` !== grupo) continue;
        usados.add(c);
        const r = await admin.post('/api/clientes').send({ razonSocial: nombre, cuit: c, condicionIva: 'RI', estado: 'ACTIVO', etiquetas: ['mensual'] }).expect(201);
        ids[nombre] = r.body.id;
        break;
      }
    }
  });

  it('crea tareas y calcula la situación según la fecha', async () => {
    const mal = await user.post('/api/tareas').send({ clienteId: ids['Cliente A'], titulo: 'Llamar', vence: '2026-02-31' }).expect(400);
    expect(mal.body.detalles.vence).toBeDefined();
    const ayer = await user.post('/api/tareas').send({ clienteId: ids['Cliente A'], titulo: 'Atrasada', vence: sumarDias(hoy(), -1) }).expect(201);
    expect(ayer.body.situacion).toBe('VENCIDA');
    expect(ayer.body.asignadoNombre).toBe('Ana'); // por defecto, quien la crea
    const hoyT = await user.post('/api/tareas').send({ clienteId: ids['Cliente A'], titulo: 'De hoy', vence: hoy() }).expect(201);
    expect(hoyT.body.situacion).toBe('HOY');
    const prox = await user.post('/api/tareas').send({ clienteId: ids['Cliente B'], titulo: 'Próxima', vence: sumarDias(hoy(), 3) }).expect(201);
    expect(prox.body.situacion).toBe('PROXIMA');
    await user.post('/api/tareas').send({ clienteId: 'no-existe', titulo: 'X', vence: hoy() }).expect(400);
    ids.tareaAyer = ayer.body.id;
  });

  it('lista pendientes ordenadas y permite completar y reabrir', async () => {
    const lista = (await user.get('/api/tareas?asignado=yo').expect(200)).body;
    expect(lista.map((t) => t.titulo)).toEqual(['Atrasada', 'De hoy', 'Próxima']);
    const hecha = await user.patch(`/api/tareas/${ids.tareaAyer}`).send({ hecha: true }).expect(200);
    expect(hecha.body.situacion).toBe('CERRADA');
    expect((await user.get('/api/tareas').expect(200)).body).toHaveLength(2);
    // Con clienteId se ven también las hechas
    expect((await user.get(`/api/tareas?clienteId=${ids['Cliente A']}`).expect(200)).body).toHaveLength(2);
    await user.patch(`/api/tareas/${ids.tareaAyer}`).send({ hecha: false }).expect(200);
  });

  it('solo el autor o un admin borra una tarea', async () => {
    const t = await admin.post('/api/tareas').send({ clienteId: ids['Cliente C'], titulo: 'Del admin', vence: hoy() }).expect(201);
    await user.delete(`/api/tareas/${t.body.id}`).expect(403);
    await admin.delete(`/api/tareas/${t.body.id}`).expect(204);
  });

  it('carga vencimientos manuales sin duplicarlos', async () => {
    const v = { clienteId: ids['Cliente A'], impuesto: 'IVA', periodo: '2026-09', vence: sumarDias(hoy(), -2) };
    const r = await user.post('/api/vencimientos').send(v).expect(201);
    expect(r.body.situacion).toBe('VENCIDA');
    await user.post('/api/vencimientos').send(v).expect(409);
    await user.post('/api/vencimientos').send({ ...v, periodo: '2026-13' }).expect(400);
    ids.venc = r.body.id;
  });

  it('genera vencimientos masivos según terminación de CUIT', async () => {
    const cuerpo = { impuesto: 'Ganancias', periodo: '2026-10', fechas: { '0-1': '2026-11-18', '2-3': '2026-11-19' } };
    await user.post('/api/vencimientos/generar').send({ ...cuerpo, fechas: {} }).expect(400);
    const r = await user.post('/api/vencimientos/generar').send(cuerpo).expect(201);
    expect(r.body.creados).toBe(2); // Cliente C termina en 6-7 y no tiene fecha
    // Repetir no duplica
    const otra = await user.post('/api/vencimientos/generar').send(cuerpo).expect(201);
    expect(otra.body).toMatchObject({ creados: 0, yaExistian: 2 });
    // El filtro por etiqueta que no existe no genera nada
    expect((await user.post('/api/vencimientos/generar').send({ ...cuerpo, impuesto: 'IIBB', etiqueta: 'otra' }).expect(201)).body.creados).toBe(0);
  });

  it('marca presentado y refleja las alertas', async () => {
    const a = (await user.get('/api/alertas').expect(200)).body;
    expect(a.tareas).toMatchObject({ vencidas: 1, hoy: 1, proximas: 1 });
    expect(a.vencimientos.vencidos).toBe(1);
    expect(a.urgentes).toBe(3);
    const p = await user.patch(`/api/vencimientos/${ids.venc}`).send({ estado: 'PRESENTADO' }).expect(200);
    expect(p.body.situacion).toBe('CERRADA');
    expect((await user.get('/api/alertas').expect(200)).body.vencimientos.vencidos).toBe(0);
    await user.patch(`/api/vencimientos/${ids.venc}`).send({ estado: 'otro' }).expect(400);
  });

  it('borrar un cliente definitivamente borra sus tareas y vencimientos', async () => {
    await admin.delete(`/api/clientes/${ids['Cliente A']}?definitivo=true`).expect(204);
    expect((await user.get('/api/tareas').expect(200)).body.every((t) => t.clienteId !== ids['Cliente A'])).toBe(true);
    expect((await user.get(`/api/vencimientos?clienteId=${ids['Cliente A']}`).expect(200)).body).toHaveLength(0);
  });
});

describe('cambio de contraseña', () => {
  it('valida la actual y exige una nueva distinta y de 8+ caracteres', async () => {
    await user.post('/api/auth/password').send({ actual: 'mala', nueva: 'nuevaclave1' }).expect(400);
    await user.post('/api/auth/password').send({ actual: 'clave12345', nueva: 'corta' }).expect(400);
    await user.post('/api/auth/password').send({ actual: 'clave12345', nueva: 'clave12345' }).expect(400);
    await user.post('/api/auth/password').send({ actual: 'clave12345', nueva: 'nuevaclave1' }).expect(200);
    await request(app).post('/api/auth/login').send({ email: 'ana@t.com', password: 'clave12345' }).expect(401);
    await request(app).post('/api/auth/login').send({ email: 'ana@t.com', password: 'nuevaclave1' }).expect(200);
  });
});
