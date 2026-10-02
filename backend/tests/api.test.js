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
  for (const c of ['clientes', 'cuits', 'usuarios', 'tareas', 'vencimientos', 'calendarios']) await db.recursiveDelete(db.collection(c));
  await invalidar();
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

// ---------- Calendario impositivo ----------
const fs = require('fs');
const path = require('path');
const PDF = path.join(__dirname, 'fixtures/calendario-octubre-2026.pdf');

describe('calendario impositivo', () => {
  it('rechaza lo que no es un PDF', async () => {
    await user.post('/api/calendarios/importar').set('Content-Type', 'application/pdf').send(Buffer.from('hola')).expect(400);
  });

  // El PDF es material de terceros: no está en el repositorio, el test corre si existe en tests/fixtures.
  it.skipIf(!fs.existsSync(PDF))('lee el PDF de Errepar completo y sin avisos', async () => {
    const r = await user.post('/api/calendarios/importar').set('Content-Type', 'application/pdf').send(fs.readFileSync(PDF)).expect(200);
    expect(r.body.periodo).toBe('2026-10');
    expect(r.body.filas).toHaveLength(25);
    expect(r.body.avisos).toEqual([]);
    const fila = (txt) => r.body.filas.find((f) => f.titulo.includes(txt));
    // Autónomos: 0-1 y 2-3 el 5; 4-5 y 6 el 6; 7-8 y 9 el 7
    expect(fila('Autónomos').fechas).toMatchObject({ 0: '2026-10-05', 3: '2026-10-05', 4: '2026-10-06', 6: '2026-10-06', 8: '2026-10-07', 9: '2026-10-07' });
    // "Todos" vence el mismo día para cualquier terminación
    expect(Object.values(fila('Monotributo').fechas).every((f) => f === '2026-10-20')).toBe(true);
    // Convenio Multilateral agrupa distinto: 0-1/2, 3-4/5, 6-7, 8-9
    expect(fila('Convenio Multilateral').fechas).toMatchObject({ 2: '2026-10-15', 3: '2026-10-16', 5: '2026-10-16', 7: '2026-10-19', 9: '2026-10-20' });
    expect(r.body.filas.every((f) => Object.values(f.fechas).every(Boolean))).toBe(true);
    // Las claves son únicas y no incluyen meses ni años
    const claves = r.body.filas.map((f) => f.clave);
    expect(new Set(claves).size).toBe(claves.length);
    expect(claves.some((c) => /2026|septiembre/.test(c))).toBe(false);
  });

  const fechasPor = (porDigito) => Object.fromEntries('0123456789'.split('').map((d) => [d, porDigito(d)]));
  const calendario = (iva) => ({
    filas: [
      { seccion: 'NACIONALES', obligacion: 'Impuesto al Valor Agregado', concepto: 'DDJJ - Septiembre/2026', notas: '', clave: 'iva ddjj', titulo: 'Impuesto al Valor Agregado – DDJJ',
        fechas: fechasPor((d) => (Number(d) < 5 ? iva : '2026-10-21')) },
      { seccion: 'NACIONALES', obligacion: 'Monotributo', concepto: 'Octubre 2026', notas: '', clave: 'monotributo', titulo: 'Monotributo', fechas: fechasPor(() => '2026-10-20') },
    ],
  });
  let cli;

  it('guarda el calendario, valida y lo ofrece como catálogo', async () => {
    await user.put('/api/calendarios/2026-13').send(calendario('2026-10-19')).expect(400);
    await user.put('/api/calendarios/2026-10').send({ filas: [] }).expect(400);
    const mal = calendario('2026-10-19'); mal.filas[0].fechas['3'] = '2026-02-31';
    await user.put('/api/calendarios/2026-10').send(mal).expect(400);
    await user.put('/api/calendarios/2026-10').send(calendario('2026-10-19')).expect(200);
    expect((await user.get('/api/calendarios').expect(200)).body).toMatchObject([{ periodo: '2026-10', filas: 2 }]);
    expect((await user.get('/api/calendarios/catalogo').expect(200)).body.map((c) => c.clave)).toEqual(['iva ddjj', 'monotributo']);
    await user.delete('/api/calendarios/2026-10').expect(403);
  });

  it('genera vencimientos según obligaciones y terminación del CUIT', async () => {
    // Cliente cuyo CUIT termina en 6 (>=5) y otro que termina en 0-4
    const buscar = (condicion) => { for (let n = 2000000000; ; n++) { const c = cuitDe(String(n)); if (c && condicion(Number(c[10]))) return c; } };
    const a = await user.post('/api/clientes').send({ razonSocial: 'Cal Alto', cuit: buscar((d) => d >= 5), condicionIva: 'RI', estado: 'ACTIVO', obligaciones: ['iva ddjj', 'monotributo'] }).expect(201);
    const b = await user.post('/api/clientes').send({ razonSocial: 'Cal Bajo', cuit: buscar((d) => d < 5 && d !== 0), condicionIva: 'RI', estado: 'ACTIVO', obligaciones: ['iva ddjj'] }).expect(201);
    await user.post('/api/clientes').send({ razonSocial: 'Cal Sin Obligaciones', cuit: buscar((d) => d === 0), condicionIva: 'RI', estado: 'ACTIVO' }).expect(201);
    await user.post('/api/clientes').send({ razonSocial: 'Cal Potencial', estado: 'POTENCIAL', obligaciones: ['iva ddjj'] }).expect(201);
    cli = { a: a.body.id, b: b.body.id };
    expect(a.body.obligaciones).toEqual(['iva ddjj', 'monotributo']);

    const r = await user.post('/api/calendarios/2026-10/aplicar').expect(200);
    expect(r.body).toMatchObject({ clientes: 2, creados: 3, actualizados: 0, sinCambios: 0 });
    const va = (await user.get(`/api/vencimientos?clienteId=${cli.a}`).expect(200)).body;
    const vb = (await user.get(`/api/vencimientos?clienteId=${cli.b}`).expect(200)).body;
    expect(va.map((v) => [v.clave, v.vence]).sort()).toEqual([['iva ddjj', '2026-10-21'], ['monotributo', '2026-10-20']]);
    expect(vb.map((v) => [v.clave, v.vence])).toEqual([['iva ddjj', '2026-10-19']]);
    expect(vb[0].origen).toBe('calendario');
  });

  it('aplicar de nuevo no duplica; actualiza fechas corregidas salvo las ya presentadas', async () => {
    expect((await user.post('/api/calendarios/2026-10/aplicar').expect(200)).body).toMatchObject({ creados: 0, actualizados: 0, sinCambios: 3 });
    const vb = (await user.get(`/api/vencimientos?clienteId=${cli.b}`)).body[0];
    const va = (await user.get(`/api/vencimientos?clienteId=${cli.a}`)).body.find((v) => v.clave === 'iva ddjj');
    await user.patch(`/api/vencimientos/${va.id}`).send({ estado: 'PRESENTADO' }).expect(200);
    // ARCA corrige la fecha: el pendiente se actualiza, el presentado no
    await user.put('/api/calendarios/2026-10').send(calendario('2026-10-22')).expect(200);
    expect((await user.post('/api/calendarios/2026-10/aplicar').expect(200)).body).toMatchObject({ creados: 0, actualizados: 1, sinCambios: 2 });
    expect((await user.get(`/api/vencimientos?clienteId=${cli.b}`)).body.find((v) => v.id === vb.id).vence).toBe('2026-10-22');
    expect((await user.get(`/api/vencimientos?clienteId=${cli.a}`)).body.find((v) => v.id === va.id).vence).toBe('2026-10-21');
    await admin.delete('/api/calendarios/2026-10').expect(204);
    await user.post('/api/calendarios/2026-10/aplicar').expect(404);
  });
});

// ---------- Hosting serverless: caché entre instancias y lecturas acotadas ----------
describe('caché compartida y Agenda acotada', () => {
  it('otra instancia ve los cambios gracias al contador de versión', async () => {
    const { db: base } = require('../src/db');
    const antes = (await user.get('/api/clientes?q=Instancia').expect(200)).body.total;
    expect(antes).toBe(0);
    // Simula que OTRA instancia del servidor crea un cliente y sube el contador de versión.
    await base.collection('clientes').add({ razonSocial: 'Cliente Instancia B', estado: 'POTENCIAL', etiquetas: [], obligaciones: [], creadoEn: new Date(), actualizadoEn: new Date() });
    await base.collection('meta').doc('clientes').set({ version: require('firebase-admin/firestore').FieldValue.increment(1) }, { merge: true });
    expect((await user.get('/api/clientes?q=Instancia').expect(200)).body.total).toBe(1);
  });

  it('la Agenda trae lo vencido y lo próximo, no todo el futuro', async () => {
    const c = (await user.post('/api/clientes').send({ razonSocial: 'Cliente Agenda' }).expect(201)).body.id;
    const lejana = await user.post('/api/tareas').send({ clienteId: c, titulo: 'Lejana', vence: sumarDias(hoy(), 20) }).expect(201);
    await user.post('/api/vencimientos').send({ clienteId: c, impuesto: 'IVA', periodo: '2026-10', vence: sumarDias(hoy(), 20) }).expect(201);
    const titulos = async (url) => (await user.get(url).expect(200)).body.map((x) => x.titulo || x.impuesto);
    expect(await titulos('/api/tareas')).not.toContain('Lejana');
    expect(await titulos('/api/tareas?asignado=yo')).not.toContain('Lejana');
    expect(await titulos('/api/tareas?dias=30')).toContain('Lejana');
    expect(await titulos('/api/tareas?asignado=yo&dias=30')).toContain('Lejana');
    expect((await user.get('/api/vencimientos').expect(200)).body.some((v) => v.clienteId === c)).toBe(false);
    expect((await user.get('/api/vencimientos?dias=30').expect(200)).body.some((v) => v.clienteId === c)).toBe(true);
    // En la ficha del cliente se ve todo, y completar una tarea la saca de las alertas
    expect((await user.get(`/api/tareas?clienteId=${c}`).expect(200)).body).toHaveLength(1);
    await user.patch(`/api/tareas/${lejana.body.id}`).send({ hecha: true }).expect(200);
    expect(await titulos('/api/tareas?dias=30')).not.toContain('Lejana');
    // Reabrirla la devuelve, y cambiar la fecha la mueve fuera del horizonte
    await user.patch(`/api/tareas/${lejana.body.id}`).send({ hecha: false, vence: hoy() }).expect(200);
    expect(await titulos('/api/tareas')).toContain('Lejana');
  });
});

// ---------- Arranque en Vercel con configuración incompleta ----------
describe('función de Vercel (api/index.js)', () => {
  const { execFileSync } = require('child_process');
  const raiz = path.join(__dirname, '../..');

  // Ejecuta api/index.js en un proceso limpio, sin emulador, y devuelve la respuesta a un GET.
  function respuesta(env) {
    const limpio = { PATH: process.env.PATH, NODE_ENV: 'production', ...env };
    const salida = execFileSync('node', ['-e', `
      const h = require(${JSON.stringify(path.join(raiz, 'api/index.js'))});
      const res = { setHeader() {}, end(b) { console.log(JSON.stringify({ status: this.statusCode, body: b })); } };
      Promise.resolve(h({ method: 'GET', url: '/api/salud', headers: {} }, res));
    `], { env: limpio, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(salida.trim().split('\n').pop());
  }

  it('avisa si falta JWT_SECRET', () => {
    const r = respuesta({ FIREBASE_SERVICE_ACCOUNT: '{}' });
    expect(r.status).toBe(500);
    expect(r.body).toContain('JWT_SECRET');
  });
  it('avisa si falta FIREBASE_SERVICE_ACCOUNT', () => {
    const r = respuesta({ JWT_SECRET: 'un-secreto-bien-largo-123' });
    expect(r.status).toBe(500);
    expect(r.body).toContain('FIREBASE_SERVICE_ACCOUNT');
  });
  it('no filtra la clave si se pegó con comillas o mal formada', () => {
    const clave = 'CLAVE-PRIVADA-SECRETA-123';
    for (const valor of [`"{\\"private_key\\":\\"${clave}\\"}"`, `{"private_key": "${clave}"`, `{"type":"service_account","private_key":"${clave}"}`]) {
      const r = respuesta({ JWT_SECRET: 'un-secreto-bien-largo-123', FIREBASE_SERVICE_ACCOUNT: valor });
      expect(r.status).toBe(500);
      expect(r.body).toContain('FIREBASE_SERVICE_ACCOUNT');
      expect(r.body).not.toContain(clave);
    }
  });
});
