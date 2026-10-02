const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const prisma = require('../src/db');
const { cuitValido } = require('../src/validacion');

let admin, user;

async function login(email, password = 'clave12345') {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password }).expect(200);
  return agent;
}

beforeAll(async () => {
  await prisma.interaccion.deleteMany();
  await prisma.cliente.deleteMany();
  await prisma.etiqueta.deleteMany();
  await prisma.usuario.deleteMany();
  const passwordHash = await bcrypt.hash('clave12345', 4);
  await prisma.usuario.create({ data: { nombre: 'Admin', email: 'admin@t.com', passwordHash, rol: 'ADMIN' } });
  await prisma.usuario.create({ data: { nombre: 'Ana', email: 'ana@t.com', passwordHash } });
  admin = await login('admin@t.com');
  user = await login('ana@t.com');
});
afterAll(() => prisma.$disconnect());

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
      .send({ razonSocial: 'Perez SRL', cuit: '20-12345678-6', condicionIva: 'Responsable Inscripto',
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
  });
  it('actualiza y registra interacciones', async () => {
    const u = await user.put(`/api/clientes/${id}`).send({ razonSocial: 'Perez SA', cuit: '20-12345678-6',
      condicionIva: 'RI', estado: 'ACTIVO', etiquetas: [] }).expect(200);
    expect(u.body.razonSocial).toBe('Perez SA');
    const i = await user.post(`/api/clientes/${id}/interacciones`).send({ tipo: 'LLAMADA', detalle: 'Consulta IVA' }).expect(201);
    expect((await user.get(`/api/clientes/${id}/interacciones`)).body).toHaveLength(1);
    await admin.delete(`/api/clientes/${id}/interacciones/${i.body.id}`).expect(204);
  });
  it('archiva por defecto y borra definitivo solo admin', async () => {
    expect((await user.delete(`/api/clientes/${id}`).expect(200)).body.estado).toBe('INACTIVO');
    await user.delete(`/api/clientes/${id}?definitivo=true`).expect(403);
    await admin.delete(`/api/clientes/${id}?definitivo=true`).expect(204);
    await user.get(`/api/clientes/${id}`).expect(404);
  });
});
