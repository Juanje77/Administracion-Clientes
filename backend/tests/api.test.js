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
  await db.collection('usuarios').add({ nombre: 'Ana', email: 'ana@t.com', passwordHash, rol: 'USUARIO', activo: true, verDinero: true }); // con acceso a los montos (los tests de honorarios la usan)
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
    await admin.post('/api/usuarios').send({ nombre: 'Luis', email: 'luis@t.com', password: 'clave12345', accesoClientes: 'TODOS' }).expect(201);
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

// ---------- Importación de clientes desde Excel / CSV ----------
describe('importación de clientes', () => {
  const writeXlsxFile = require('write-excel-file/node').default;
  const celda = (value) => ({ value, type: typeof value === 'number' ? Number : String });
  const xlsx = async (filas) => Buffer.from(await writeXlsxFile(filas.map((f) => f.map(celda))).toBuffer());
  const subir = (agente, cuerpo, query = '') => agente.post(`/api/importacion/clientes${query}`).set('Content-Type', 'application/octet-stream').send(cuerpo);

  const cuitFisica = cuitDe('2712345678');   // persona física (27)
  const cuitSociedad = cuitDe('3012345678'); // persona jurídica (30)
  const cuitMalo = cuitSociedad.slice(0, 10) + String((Number(cuitSociedad[10]) + 1) % 10);
  let archivo;

  beforeAll(async () => {
    for (const c of ['clientes', 'cuits']) await db.recursiveDelete(db.collection(c));
    await invalidar();
    archivo = await xlsx([
      ['Cliente', 'CUIT/DNI', 'Correo', 'Celular', 'Localidad', 'Condición IVA', 'Estado', 'Etiquetas', 'Observaciones'],
      ['Ana Gómez', Number(cuitFisica), 'ANA@x.com', 2954123456, 'Santa Rosa', 'Monotributo', 'Activo', 'mensual, sueldos', 'Llamar en marzo'],
      ['Sociedad Uno SRL', cuitSociedad, 'uno@x.com', '2954-111222', 'General Pico', 'RI', '', '', ''],
      ['Sin Cuit Pérez', '', '', '', '', '', '', '', ''],
      ['Persona Con Dni', 30123456, '', '', '', '', '', '', ''],
      ['Cuit Equivocado', cuitMalo, '', '', '', '', '', '', ''],
      ['', cuitDe('2799999999'), '', '', '', '', '', '', ''],
      ['Ana Repetida', cuitFisica, '', '', '', '', '', '', ''],
      ['Mail Malo', '', 'no-es-mail', 'abc', '', '', '', '', ''],
    ]);
  });

  it('solo los administradores importan', async () => {
    await subir(user, archivo).expect(403);
    await user.get('/api/importacion/plantilla').expect(403);
  });

  it('detecta columnas, normaliza y clasifica sin guardar nada', async () => {
    const r = (await subir(admin, archivo).expect(200)).body;
    expect(r.mapeo).toMatchObject({ 0: 'razonSocial', 1: 'cuit', 2: 'email', 3: 'telefono', 4: 'ciudad', 5: 'condicionIva', 6: 'estado', 7: 'etiquetas', 8: 'notas' });
    expect(r.resumen).toEqual({ total: 8, ok: 2, advertencias: 4, rechazadas: 2 });
    const fila = (nombre) => r.filas.find((f) => f.nombre === nombre);
    expect(fila('Ana Gómez').datos).toMatchObject({
      cuit: `${cuitFisica.slice(0, 2)}-${cuitFisica.slice(2, 10)}-${cuitFisica[10]}`, email: 'ana@x.com', tipoPersona: 'FISICA',
      condicionIva: 'Monotributista', estado: 'ACTIVO', etiquetas: ['mensual', 'sueldos'], notas: 'Llamar en marzo', ciudad: 'Santa Rosa',
    });
    expect(fila('Sociedad Uno SRL').datos).toMatchObject({ estado: 'ACTIVO', tipoPersona: 'JURIDICA' }); // estado calculado
    expect(fila('Sin Cuit Pérez')).toMatchObject({ estado: 'ADVERTENCIA' });
    expect(fila('Sin Cuit Pérez').datos.estado).toBe('POTENCIAL');
    expect(fila('Persona Con Dni').datos).toMatchObject({ cuit: null, notas: 'DNI: 30123456' });
    expect(fila('Cuit Equivocado').advertencias[0]).toMatch(/CUIT inválido/);
    expect(fila('Mail Malo').datos).toMatchObject({ email: null, telefono: null });
    expect(r.filas.find((f) => f.n === 7).motivo).toMatch(/nombre/i);
    expect(fila('Ana Repetida').motivo).toMatch(/Ya existe un cliente con ese CUIT/);
    expect((await admin.get('/api/clientes').expect(200)).body.total).toBe(0); // la vista previa no guarda
  });

  it('confirma la importación y volver a importar no duplica', async () => {
    const r = (await subir(admin, archivo, '?confirmar=1').expect(201)).body;
    expect(r).toMatchObject({ creados: 6, fallidos: 0, rechazadas: 2, conAdvertencias: 4 });
    const lista = (await admin.get('/api/clientes?porPagina=50').expect(200)).body;
    expect(lista.total).toBe(6);
    expect(lista.datos.find((c) => c.razonSocial === 'Ana Gómez').etiquetas.map((e) => e.nombre)).toEqual(['mensual', 'sueldos']);
    // El CUIT importado queda reservado: no se puede crear otro cliente igual a mano
    await admin.post('/api/clientes').send({ razonSocial: 'Otro', cuit: cuitSociedad }).expect(409);
    const otra = (await subir(admin, archivo, '?confirmar=1').expect(201)).body;
    expect(otra).toMatchObject({ creados: 0, rechazadas: 8 });
    expect((await admin.get('/api/clientes').expect(200)).body.total).toBe(6);
  });

  it('lee CSV con ; y acentos de Windows, y respeta comillas', async () => {
    const csv = 'Razón social;CUIT;Teléfono;Notas\r\nJosé Núñez;' + cuitDe('2055555555') + ';2954 555555;"Dijo: ""hola""; vuelve mañana"\r\n';
    const r = (await subir(admin, Buffer.from(csv, 'latin1')).expect(200)).body;
    expect(r.filas[0].datos).toMatchObject({ razonSocial: 'José Núñez', telefono: '2954 555555', notas: 'Dijo: "hola"; vuelve mañana' });
    expect(r.resumen.rechazadas).toBe(0);
  });

  it('permite corregir el mapeo de columnas', async () => {
    const raro = await xlsx([['Dato A', 'Dato B'], ['Cliente Raro SA', cuitDe('3077777777')]]);
    expect((await subir(admin, raro).expect(200)).body.resumen).toMatchObject({ rechazadas: 1 });
    const mapeo = encodeURIComponent(JSON.stringify({ 0: 'razonSocial', 1: 'cuit' }));
    const r = (await subir(admin, raro, `?mapeo=${mapeo}`).expect(200)).body;
    expect(r.resumen).toMatchObject({ total: 1, rechazadas: 0 });
    expect(r.filas[0].datos.tipoPersona).toBe('JURIDICA');
  });

  it('rechaza archivos vacíos o ilegibles', async () => {
    await subir(admin, Buffer.from('solo,encabezados\n')).expect(422);
    await admin.post('/api/importacion/clientes').expect(400);
  });

  it('la plantilla descargable se puede importar tal cual, sin avisos', async () => {
    for (const c of ['clientes', 'cuits']) await db.recursiveDelete(db.collection(c)); // el ejemplo usa un CUIT que otro test ya cargó
    await invalidar();
    const r = await admin.get('/api/importacion/plantilla').buffer(true).parse((res, cb) => { const d = []; res.on('data', (c) => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); }).expect(200);
    expect(r.headers['content-disposition']).toMatch(/plantilla-clientes\.xlsx/);
    const vista = (await subir(admin, r.body).expect(200)).body;
    expect(vista.resumen).toEqual({ total: 1, ok: 1, advertencias: 0, rechazadas: 0 });
  });
});

// ---------- Honorarios, cobros y saldos ----------
describe('honorarios y cobros', () => {
  const periodo = hoy().slice(0, 7);
  const anterior = sumarDias(hoy(), -40).slice(0, 7);
  const c = {};
  let h; // honorario del cliente A en el período actual

  beforeAll(async () => {
    for (const col of ['clientes', 'cuits', 'honorarios', 'pagos', 'resumenes']) await db.recursiveDelete(db.collection(col));
    await invalidar();
    const nuevo = (nombre, cuit, extra) => admin.post('/api/clientes').send({ razonSocial: nombre, cuit: cuitDe(cuit), condicionIva: 'RI', estado: 'ACTIVO', ...extra }).expect(201);
    c.a = (await nuevo('Hon A', '2011111111', { abonoMensual: 100000 })).body.id;
    c.b = (await nuevo('Hon B', '2022222222', { abonoMensual: '50000.50' })).body.id;
    c.c = (await nuevo('Hon C sin abono', '2033333333', {})).body.id;
    await admin.post('/api/clientes').send({ razonSocial: 'Hon Potencial', estado: 'POTENCIAL', abonoMensual: 999 }).expect(201);
  });

  it('valida el abono mensual del cliente', async () => {
    await admin.post('/api/clientes').send({ razonSocial: 'Abono Malo', abonoMensual: -5 }).expect(400);
    const r = await admin.post('/api/clientes').send({ razonSocial: 'Abono Vacío', abonoMensual: '' }).expect(201);
    expect(r.body.abonoMensual).toBeNull();
    expect((await admin.get(`/api/clientes/${c.b}`)).body.abonoMensual).toBe(50000.5);
  });

  it('genera el abono del mes solo para activos con abono, sin duplicar', async () => {
    await user.post('/api/honorarios/generar').send({ periodo: '2026-13' }).expect(400);
    expect((await user.post('/api/honorarios/generar').send({ periodo }).expect(201)).body).toMatchObject({ creados: 2, yaExistian: 0 });
    expect((await user.post('/api/honorarios/generar').send({ periodo }).expect(201)).body).toMatchObject({ creados: 0, yaExistian: 2 });
    const r = (await user.get(`/api/honorarios?periodo=${periodo}`).expect(200)).body;
    expect(r.datos.map((x) => x.clienteNombre)).toEqual(['Hon A', 'Hon B']);
    expect(r.totales).toEqual({ monto: 150000.5, pagado: 0, saldo: 150000.5 });
    h = r.datos.find((x) => x.clienteId === c.a);
    expect(h).toMatchObject({ concepto: 'Honorarios mensuales', estado: 'PENDIENTE', vencido: false });
  });

  it('registra cobros parciales y totales, y rechaza los inválidos', async () => {
    const cobrar = (monto, extra = {}) => user.post(`/api/honorarios/${h.id}/pagos`).send({ monto, medio: 'TRANSFERENCIA', ...extra });
    await cobrar(0).expect(400);
    await cobrar(-5).expect(400);
    await cobrar(10, { fecha: '2026-02-31' }).expect(400);
    await cobrar(10, { medio: 'BITCOIN' }).expect(400);
    const parcial = (await cobrar(40000.25, { nota: 'Primera cuota' }).expect(201)).body;
    expect(parcial.honorario).toMatchObject({ pagado: 40000.25, saldo: 59999.75, estado: 'PARCIAL' });
    await cobrar(70000).expect(400); // supera el saldo
    const total = (await cobrar(59999.75, { medio: 'EFECTIVO' }).expect(201)).body;
    expect(total.honorario).toMatchObject({ saldo: 0, estado: 'PAGADO' });
    await cobrar(1).expect(400); // ya está saldado
    expect((await user.get(`/api/honorarios/${h.id}/pagos`).expect(200)).body).toHaveLength(2);
    expect((await user.get(`/api/honorarios?periodo=${periodo}&estado=PAGADO`).expect(200)).body.datos).toHaveLength(1);
    c.pagoId = parcial.pago.id;
  });

  it('calcula deudores sumando períodos y marca lo vencido', async () => {
    await user.post('/api/honorarios').send({ clienteId: c.b, periodo: anterior, concepto: 'Balance anual', monto: 20000 }).expect(201);
    await user.post('/api/honorarios').send({ clienteId: c.b, periodo, concepto: 'X', monto: 0 }).expect(400);
    const d = (await user.get('/api/honorarios/deudores').expect(200)).body;
    expect(d.datos).toHaveLength(1);
    expect(d.datos[0]).toMatchObject({ clienteNombre: 'Hon B', saldo: 70000.5, cantidad: 2, masAntiguo: anterior });
    expect(d.total).toBe(70000.5);
    const deuda = (await user.get('/api/honorarios?estado=DEUDA').expect(200)).body; // sin período: todo lo adeudado
    expect(deuda.totales.saldo).toBe(70000.5);
    expect(deuda.datos.find((x) => x.periodo === anterior).vencido).toBe(true);
    expect((await user.get(`/api/honorarios?clienteId=${c.b}`).expect(200)).body.datos).toHaveLength(2);
  });

  it('edita montos sin bajar de lo cobrado y recalcula el saldo', async () => {
    await user.patch(`/api/honorarios/${h.id}`).send({ monto: 90000 }).expect(400); // ya cobró 100000
    const r = await user.patch(`/api/honorarios/${h.id}`).send({ monto: 120000 }).expect(200);
    expect(r.body).toMatchObject({ monto: 120000, saldo: 20000, estado: 'PARCIAL' });
    await user.patch('/api/honorarios/no-existe').send({ monto: 5 }).expect(404);
  });

  it('solo un administrador anula cobros y borra honorarios', async () => {
    await user.delete(`/api/honorarios/${h.id}/pagos/${c.pagoId}`).expect(403);
    await admin.delete(`/api/honorarios/${h.id}/pagos/${c.pagoId}`).expect(204);
    const r = (await user.get(`/api/honorarios?clienteId=${c.a}`).expect(200)).body.datos[0];
    expect(r).toMatchObject({ pagado: 59999.75, saldo: 60000.25 });
    await user.delete(`/api/honorarios/${h.id}`).expect(403);
    await admin.delete(`/api/honorarios/${h.id}`).expect(204);
    expect((await user.get(`/api/honorarios/${h.id}/pagos`).expect(200)).body).toHaveLength(0);
  });

  it('al borrar un cliente definitivamente se borran sus honorarios', async () => {
    await admin.delete(`/api/clientes/${c.b}?definitivo=true`).expect(204);
    expect((await user.get('/api/honorarios/deudores').expect(200)).body.datos).toHaveLength(0);
  });
});

// ---------- Dashboard y exportaciones ----------
describe('dashboard y exportaciones', () => {
  const { readSheet } = require('read-excel-file/node');
  const [anio, mes] = hoy().split('-').map(Number);
  const periodo = hoy().slice(0, 7);
  const mesAnterior = (() => { const d = new Date(Date.UTC(anio, mes - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
  const c = {};
  const binario = (res, cb) => { const d = []; res.on('data', (x) => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); };
  const descargar = (agente, url) => agente.get(url).buffer(true).parse(binario);
  const textoPdf = async (buffer) => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
    let t = '';
    for (let i = 1; i <= doc.numPages; i++) t += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + ' ';
    return t;
  };

  beforeAll(async () => {
    for (const col of ['clientes', 'cuits', 'honorarios', 'pagos', 'resumenes']) await db.recursiveDelete(db.collection(col));
    await invalidar();
    const nuevo = (nombre, cuit, extra) => admin.post('/api/clientes').send({ razonSocial: nombre, cuit: cuitDe(cuit), condicionIva: 'RI', estado: 'ACTIVO', ...extra }).expect(201);
    c.a = (await nuevo('Dash Álvarez', '2044444444', { abonoMensual: 100000, ciudad: 'Santa Rosa', etiquetas: ['mensual'] })).body.id;
    c.b = (await nuevo('Dash B', '2055555555', { abonoMensual: 50000 })).body.id;
    await admin.post('/api/clientes').send({ razonSocial: '=SUMA(1+1)', estado: 'POTENCIAL' }).expect(201);
    await admin.post('/api/honorarios/generar').send({ periodo }).expect(201);
    const lista = (await admin.get(`/api/honorarios?periodo=${periodo}`)).body.datos;
    const hon = (id) => lista.find((h) => h.clienteId === id).id;
    await admin.post(`/api/honorarios/${hon(c.a)}/pagos`).send({ monto: 100000 }).expect(201);
    await admin.post(`/api/honorarios/${hon(c.b)}/pagos`).send({ monto: 20000, medio: 'EFECTIVO' }).expect(201);
    const previo = (await admin.post('/api/honorarios').send({ clienteId: c.a, periodo: mesAnterior, concepto: 'Balance', monto: 30000 }).expect(201)).body;
    await admin.post(`/api/honorarios/${previo.id}/pagos`).send({ monto: 10000, fecha: `${mesAnterior}-15` }).expect(201);
  });

  it('el dashboard suma clientes, facturado, cobrado y deuda', async () => {
    const d = (await user.get('/api/dashboard').expect(200)).body;
    expect(d.periodo).toBe(periodo);
    expect(d.clientes).toEqual({ total: 3, activos: 2, potenciales: 1, inactivos: 0, nuevosMes: 3 });
    expect(d.honorarios).toMatchObject({ facturado: 150000, cobrado: 120000, deudaTotal: 50000, deudoresCantidad: 2 });
    expect(d.honorarios.topDeudores.map((x) => [x.clienteNombre, x.saldo])).toEqual([['Dash B', 30000], ['Dash Álvarez', 20000]]);
    expect(d.serie).toHaveLength(6);
    expect(d.serie[5]).toEqual({ periodo, cobrado: 120000, facturado: 150000 });
    expect(d.serie[4]).toEqual({ periodo: mesAnterior, cobrado: 10000, facturado: 30000 });
    expect(d.serie[0].cobrado).toBe(0);
    expect(d.agenda).toHaveProperty('urgentes');
  });

  it('el dashboard permite elegir otro período y valida', async () => {
    const d = (await user.get(`/api/dashboard?periodo=${mesAnterior}`).expect(200)).body;
    expect(d.honorarios).toMatchObject({ facturado: 30000, cobrado: 10000 });
    expect(d.serie[5].periodo).toBe(mesAnterior);
    await user.get('/api/dashboard?periodo=2026-13').expect(400);
  });

  it('exporta clientes a Excel con filtros, y el archivo se puede volver a importar', async () => {
    const todos = await descargar(user, '/api/exportar/clientes.xlsx').expect(200);
    expect(todos.headers['content-disposition']).toMatch(/clientes-\d{4}-\d{2}-\d{2}\.xlsx/);
    const filas = await readSheet(todos.body);
    expect(filas).toHaveLength(4); // encabezado + 3 clientes
    expect(filas[0].slice(0, 3)).toEqual(['Nombre / Razón social', 'CUIT', 'Email']);
    expect(filas.find((f) => f[0] === 'Dash Álvarez')).toContain('Santa Rosa');
    const activos = await readSheet((await descargar(user, '/api/exportar/clientes.xlsx?estado=ACTIVO&q=alvarez').expect(200)).body);
    expect(activos).toHaveLength(2);
    // Round trip: las columnas exportadas las reconoce el importador
    const vista = (await admin.post('/api/importacion/clientes').set('Content-Type', 'application/octet-stream').send(todos.body).expect(200)).body;
    expect(Object.values(vista.mapeo)).toEqual(expect.arrayContaining(['razonSocial', 'cuit', 'email', 'telefono', 'direccion', 'ciudad', 'estado', 'tipoPersona', 'condicionIva', 'regimen', 'etiquetas', 'notas']));
    expect(vista.resumen.rechazadas).toBe(3); // ya existen: reimportar no duplica
  });

  it('exporta CSV con ; y BOM, y neutraliza fórmulas', async () => {
    const r = await descargar(user, '/api/exportar/clientes.csv').expect(200);
    const texto = r.body.toString('utf8');
    expect(texto.charCodeAt(0)).toBe(0xFEFF);
    expect(texto.split('\r\n')[0]).toMatch(/^﻿Nombre \/ Razón social;CUIT;Email;/);
    expect(texto).toContain('Dash Álvarez');
    expect(texto).toContain("'=SUMA(1+1)"); // no se ejecuta como fórmula en Excel
    await user.get('/api/exportar/clientes.pdf').expect(400);
    await user.get('/api/exportar/clientes.txt').expect(400);
  });

  it('exporta honorarios y deudores a Excel y PDF', async () => {
    const x = await readSheet((await descargar(user, `/api/exportar/honorarios.xlsx?periodo=${periodo}`).expect(200)).body);
    expect(x[0]).toEqual(['Cliente', 'Concepto', 'Facturado', 'Cobrado', 'Saldo', 'Estado']);
    expect(x).toHaveLength(4); // encabezado + 2 + total
    expect(x[3]).toEqual(['TOTAL', null, 150000, 120000, 30000, null]);
    expect(x.find((f) => f[0] === 'Dash B')[5]).toBe('Parcial');

    const pdf = await descargar(user, `/api/exportar/honorarios.pdf?periodo=${periodo}`).expect(200);
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    const t = await textoPdf(pdf.body);
    expect(t).toContain(`Honorarios ${periodo}`);
    expect(t).toContain('Dash Álvarez');
    expect(t).toContain('150.000,00');
    expect(t).toContain('TOTAL');

    const dx = await readSheet((await descargar(user, '/api/exportar/deudores.xlsx').expect(200)).body);
    expect(dx[1][0]).toBe('Dash B');
    expect(dx[dx.length - 1][3]).toBe(50000);
    const dt = await textoPdf((await descargar(user, '/api/exportar/deudores.pdf').expect(200)).body);
    expect(dt).toContain('Deudores');
    expect(dt).toContain('50.000,00');
    await user.get('/api/exportar/honorarios.csv').expect(400);
    await user.get('/api/exportar/honorarios.xlsx?periodo=2026-13').expect(400);
  });

  it('exige sesión', async () => {
    await request(app).get('/api/exportar/clientes.xlsx').expect(401);
    await request(app).get('/api/dashboard').expect(401);
  });
});

// ---------- Documentos adjuntos (Firebase Storage) ----------
describe('documentos adjuntos', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('contenido de prueba '.repeat(50))]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100, 2)]);
  let cliente, otro, doc;

  const subir = (agente, cuerpo, { nombre = 'contrato.pdf', categoria = 'CONTRATO', clienteId = cliente } = {}) =>
    agente.post(`/api/documentos?clienteId=${clienteId}&categoria=${categoria}&nombre=${encodeURIComponent(nombre)}`).set('Content-Type', 'application/octet-stream').send(cuerpo);
  const bajar = (agente, id, extra = '') => agente.get(`/api/documentos/${id}/descargar${extra}`).buffer(true).parse((res, cb) => { const d = []; res.on('data', (x) => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); });

  beforeAll(async () => {
    for (const col of ['clientes', 'cuits', 'documentos']) await db.recursiveDelete(db.collection(col));
    await invalidar();
    cliente = (await admin.post('/api/clientes').send({ razonSocial: 'Cliente Documentos' }).expect(201)).body.id;
    otro = await login('luis@t.com', 'clave12345');
  });

  it('sube un PDF y lo lista con sus datos', async () => {
    const r = (await subir(user, pdf, { nombre: 'Contrato de honorarios 2026.pdf' }).expect(201)).body;
    expect(r).toMatchObject({ nombre: 'Contrato de honorarios 2026.pdf', categoria: 'CONTRATO', tipo: 'application/pdf', tamano: pdf.length, subidoPorNombre: 'Ana', clienteId: cliente });
    expect(r.ruta).toMatch(new RegExp(`^clientes/${cliente}/[A-Za-z0-9]+\\.pdf$`)); // el nombre original no va en la ruta
    doc = r;
    const lista = (await user.get(`/api/documentos?clienteId=${cliente}`).expect(200)).body;
    expect(lista.map((d) => d.id)).toEqual([r.id]);
    await user.get('/api/documentos').expect(400);
  });

  it('descarga el mismo contenido, como adjunto o a la vista solo si es seguro', async () => {
    const adjunto = await bajar(user, doc.id).expect(200);
    expect(adjunto.body.equals(pdf)).toBe(true);
    expect(adjunto.headers['content-type']).toBe('application/pdf');
    expect(adjunto.headers['content-disposition']).toMatch(/^attachment; filename\*=UTF-8''Contrato%20de%20honorarios%202026\.pdf$/);
    expect(adjunto.headers['cache-control']).toMatch(/no-store/);
    expect((await bajar(user, doc.id, '?ver=1').expect(200)).headers['content-disposition']).toMatch(/^inline/);
    const word = (await subir(user, docx, { nombre: 'Nota.docx', categoria: 'OTRO' }).expect(201)).body;
    expect((await bajar(user, word.id, '?ver=1').expect(200)).headers['content-disposition']).toMatch(/^attachment/); // un .docx nunca se muestra a la vista
    await bajar(user, 'no-existe').expect(404);
    await request(app).get(`/api/documentos/${doc.id}/descargar`).expect(401);
    doc.word = word.id;
  });

  it('rechaza tipos no permitidos, contenido que no coincide y archivos vacíos o enormes', async () => {
    await subir(user, Buffer.from('MZ ejecutable'), { nombre: 'virus.exe' }).expect(400);
    await subir(user, Buffer.from('<html><script>alert(1)</script></html>'), { nombre: 'pagina.html' }).expect(400);
    await subir(user, Buffer.from('<html>soy una pagina</html>'), { nombre: 'falso.pdf' }).expect(400); // no empieza con %PDF-
    await subir(user, png, { nombre: 'foto.pdf' }).expect(400);
    await subir(user, Buffer.alloc(0), { nombre: 'vacio.pdf' }).expect(400);
    await subir(user, Buffer.concat([pdf, Buffer.alloc(5 * 1024 * 1024)])).expect(413);
    await subir(user, pdf, { nombre: '' }).expect(400);
    await subir(user, pdf, { clienteId: 'no-existe' }).expect(404);
    await subir(user, png, { nombre: 'foto.png', categoria: 'INVENTADA' }).expect(201); // categoría desconocida -> Otro
    expect((await user.get(`/api/documentos?clienteId=${cliente}`).expect(200)).body.find((d) => d.nombre === 'foto.png').categoria).toBe('OTRO');
  });

  it('limpia nombres con rutas o caracteres raros', async () => {
    const r = (await subir(user, pdf, { nombre: '../../etc/passwd<>.pdf' }).expect(201)).body;
    expect(r.nombre).toBe('passwd.pdf');
    expect(r.ruta).not.toContain('passwd');
  });

  it('avisa con claridad si Storage no está configurado', async () => {
    const guardado = process.env.FIREBASE_STORAGE_BUCKET;
    delete process.env.FIREBASE_STORAGE_BUCKET;
    try {
      const r = await subir(user, pdf).expect(503);
      expect(r.body.error).toContain('FIREBASE_STORAGE_BUCKET');
    } finally {
      process.env.FIREBASE_STORAGE_BUCKET = guardado;
    }
  });

  it('solo quien lo subió o un administrador borra un documento', async () => {
    await otro.delete(`/api/documentos/${doc.id}`).expect(403);
    await user.delete(`/api/documentos/${doc.word}`).expect(204);
    await bajar(user, doc.word).expect(404);
    await admin.delete(`/api/documentos/${doc.id}`).expect(204);
    await bajar(user, doc.id).expect(404);
    await admin.delete(`/api/documentos/${doc.id}`).expect(404);
  });

  it('al borrar un cliente definitivamente se borran sus documentos y archivos', async () => {
    const d = (await subir(user, pdf, { nombre: 'huerfano.pdf' }).expect(201)).body;
    await admin.delete(`/api/clientes/${cliente}?definitivo=true`).expect(204);
    expect((await db.collection('documentos').where('clienteId', '==', cliente).get()).empty).toBe(true);
    const [existe] = await require('../src/db').bucket().file(d.ruta).exists();
    expect(existe).toBe(false);
  });
});

// ---------- Robustez: un error dentro de una ruta asíncrona responde 500, no cuelga ----------
describe('errores inesperados', () => {
  it('responde 500 con un mensaje genérico y sin filtrar detalles', async () => {
    const { db: base } = require('../src/db');
    const original = base.collection.bind(base);
    base.collection = (nombre) => { if (nombre === 'tareas') throw new Error('detalle interno secreto'); return original(nombre); };
    try {
      const r = await user.get('/api/tareas').expect(500);
      expect(r.body).toEqual({ error: 'Error interno del servidor' });
    } finally {
      base.collection = original;
    }
    await user.get('/api/tareas').expect(200); // el servidor sigue funcionando
  });
});

// ---------- Avisos por email ----------
describe('avisos por email', () => {
  const correo = require('../src/correo/transporte');
  const A = require('../src/servicios/avisos');
  const enviados = [];
  const fallar = new Set();
  const [anio, mes] = hoy().split('-').map(Number);
  const mesPrevio = (() => { const d = new Date(Date.UTC(anio, mes - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
  const c = {};
  let luis;
  const para = (to) => enviados.filter((m) => m.to === to);
  const corrida = async (opciones) => { const antes = enviados.length; const r = await A.ejecutar(opciones); return { ...r, mails: enviados.slice(antes) }; };

  beforeAll(async () => {
    luis = await login('luis@t.com', 'clave12345');
    correo.usarTransporteDePrueba({ sendMail: async (m) => { if (fallar.has(m.to)) throw new Error('SMTP caído'); enviados.push(m); } });
    for (const col of ['clientes', 'cuits', 'honorarios', 'pagos', 'resumenes', 'tareas', 'vencimientos', 'envios', 'avisosCliente', 'config']) await db.recursiveDelete(db.collection(col));
    await invalidar();
    const nuevo = async (nombre, cuit, extra = {}) => (await admin.post('/api/clientes').send({ razonSocial: nombre, cuit: cuitDe(cuit), condicionIva: 'RI', estado: 'ACTIVO', ...extra }).expect(201)).body.id;
    c.deuda = await nuevo('Cli <b>Deuda</b>', '2066666666', { email: 'deuda@c.com' });
    c.sinMail = await nuevo('Cli SinMail', '2077777777');
    c.noRec = await nuevo('Cli NoRecord', '2088888888', { email: 'norec@c.com', recordatorios: false });
    c.pot = (await admin.post('/api/clientes').send({ razonSocial: 'Cli Potencial', email: 'pot@c.com' }).expect(201)).body.id;
    c.venc = await nuevo('Cli Venc', '2014141414', { email: 'venc@c.com' });
    for (const id of [c.deuda, c.sinMail, c.noRec, c.pot]) {
      await admin.post('/api/honorarios').send({ clienteId: id, periodo: mesPrevio, concepto: 'Honorarios mensuales', monto: 50000 }).expect(201);
    }
    await admin.post('/api/honorarios').send({ clienteId: c.deuda, periodo: hoy().slice(0, 7), concepto: 'Mes en curso', monto: 20000 }).expect(201);
    const ven = (clienteId, impuesto, dias) => admin.post('/api/vencimientos').send({ clienteId, impuesto, periodo: hoy().slice(0, 7), vence: sumarDias(hoy(), dias) }).expect(201);
    await ven(c.venc, 'IVA DDJJ', 2); await ven(c.venc, 'Ganancias lejana', 10); await ven(c.venc, 'Autónomos atrasado', -1);
    const presentado = (await ven(c.venc, 'Monotributo presentado', 1)).body;
    await admin.patch(`/api/vencimientos/${presentado.id}`).send({ estado: 'PRESENTADO' }).expect(200);
    const ana = (await admin.get('/api/usuarios').expect(200)).body.find((u) => u.email === 'ana@t.com');
    await admin.post('/api/tareas').send({ clienteId: c.venc, titulo: 'Tarea vencida de Ana', vence: sumarDias(hoy(), -2), asignadoA: ana.id }).expect(201);
    await admin.post('/api/tareas').send({ clienteId: c.venc, titulo: 'Tarea de hoy de Ana', vence: hoy(), asignadoA: ana.id }).expect(201);
    c.ana = ana.id;
  });
  afterAll(() => correo.usarTransporteDePrueba(null));

  it('solo los administradores gestionan los avisos', async () => {
    await user.get('/api/avisos/config').expect(403);
    await user.post('/api/avisos/ejecutar').expect(403);
    await user.get('/api/avisos/historial').expect(403);
    await request(app).get('/api/avisos/config').expect(401);
  });

  it('trae valores seguros por defecto y valida la configuración', async () => {
    const r = (await admin.get('/api/avisos/config').expect(200)).body;
    expect(r.config).toMatchObject({ equipoActivo: true, clientesDeuda: false, clientesVencimientos: false, diasEntreAvisosDeuda: 15, diasAnticipoVencimiento: 3 });
    expect(r.correo.configurado).toBe(true);
    const base = { ...r.config };
    await admin.put('/api/avisos/config').send({ ...base, diasEntreAvisosDeuda: 0 }).expect(400);
    await admin.put('/api/avisos/config').send({ ...base, diasAnticipoVencimiento: 99 }).expect(400);
    await admin.put('/api/avisos/config').send({ ...base, clientesDeuda: 'si' }).expect(400);
  });

  it('envía un correo de prueba al administrador', async () => {
    await admin.post('/api/avisos/prueba').expect(200);
    expect(para('admin@t.com')[0].subject).toMatch(/^Prueba de correo/);
    enviados.length = 0;
  });

  it('la vista previa no envía nada y, con los clientes apagados, solo planifica al equipo', async () => {
    const r = (await admin.get('/api/avisos/vista-previa').expect(200)).body;
    expect(r).toMatchObject({ simulacion: true, total: 3, porTipo: { equipo: 3 } });
    expect(r.mensajes.map((m) => m.to).sort()).toEqual(['admin@t.com', 'ana@t.com', 'luis@t.com']);
    expect(enviados).toHaveLength(0);
  });

  it('envía el resumen a cada integrante con lo que le corresponde, escapando HTML', async () => {
    const r = (await admin.post('/api/avisos/ejecutar').expect(200)).body;
    expect(r).toMatchObject({ enviados: 3, yaEnviados: 0, errores: [] });
    const ana = para('ana@t.com')[0];
    expect(ana.text).toContain('Tarea vencida de Ana');
    expect(ana.text).toContain('Tarea de hoy de Ana');
    expect(ana.subject).toMatch(/urgentes/);
    expect(ana.html).toContain('Clientes con deuda'); // Ana tiene acceso a los montos, así que su resumen incluye la deuda
    const adm = para('admin@t.com')[0];
    expect(adm.html).toContain('Clientes con deuda');
    expect(adm.html).toContain('&lt;b&gt;Deuda&lt;/b&gt;'); // el nombre del cliente va escapado
    expect(adm.html).not.toContain('<b>Deuda</b>');
    expect(adm.text).not.toContain('Tarea vencida de Ana'); // las tareas son de cada usuario
    expect(para('luis@t.com')[0].text).toContain('IVA DDJJ');
    expect(para('luis@t.com')[0].text).not.toContain('Tarea de hoy');
    expect(para('luis@t.com')[0].html).not.toContain('Clientes con deuda');
  });

  it('no repite el envío si se ejecuta de nuevo el mismo día', async () => {
    const r = (await corrida()).mails;
    expect(r).toHaveLength(0);
    expect((await admin.post('/api/avisos/ejecutar').expect(200)).body).toMatchObject({ enviados: 0, yaEnviados: 3 });
  });

  it('respeta la preferencia de cada usuario', async () => {
    await luis.patch('/api/auth/preferencias').send({ avisos: false }).expect(200);
    await luis.patch('/api/auth/preferencias').send({ avisos: 'no' }).expect(400);
    const r = await corrida({ hoy: sumarDias(hoy(), 1) }); // "mañana": otra clave diaria
    expect(r.mails.map((m) => m.to).sort()).toEqual(['admin@t.com', 'ana@t.com']);
    await luis.patch('/api/auth/preferencias').send({ avisos: true }).expect(200);
  });

  it('no escribe a clientes mientras estén apagados', async () => {
    expect(enviados.filter((m) => /@c\.com$/.test(m.to))).toHaveLength(0);
  });

  it('recordatorio de deuda: solo clientes activos, con email, que lo permiten y por lo atrasado', async () => {
    const base = (await admin.get('/api/avisos/config')).body.config;
    await admin.put('/api/avisos/config').send({ ...base, clientesDeuda: true, textoPago: 'Transferir al CBU <1234>\nGracias' }).expect(200);
    const r = await corrida();
    const mails = r.mails.filter((m) => /@c\.com$/.test(m.to));
    expect(mails.map((m) => m.to)).toEqual(['deuda@c.com']); // no sinMail, ni norec, ni potencial
    const m = mails[0];
    expect(m.subject).toMatch(/Honorarios pendientes/);
    expect(m.text.replace(/\u00a0/g, ' ')).toContain('Total adeudado: $ 50.000,00'); // no suma el mes en curso (el importe usa espacio de no separación)
    expect(m.html).not.toContain('Mes en curso');
    expect(m.html).toContain('Transferir al CBU &lt;1234&gt;');
    expect(m.html).toContain('Cli &lt;b&gt;Deuda&lt;/b&gt;');
    expect(m.html).toMatch(/ignore este mensaje/);
    expect(m.text).toMatch(/responda a este correo y lo daremos de baja/); // el pie también va en la versión de texto
  });

  it('respeta la pausa entre avisos de deuda del mismo cliente', async () => {
    const aviso = async (dias) => (await corrida({ hoy: sumarDias(hoy(), dias) })).mails.filter((m) => m.to === 'deuda@c.com');
    expect(await aviso(1)).toHaveLength(0);   // pasó 1 día de 15
    expect(await aviso(14)).toHaveLength(0);
    expect(await aviso(16)).toHaveLength(1);  // ya pasaron 15 días
    expect(await aviso(17)).toHaveLength(0);
  });

  it('recordatorio de vencimientos: solo los próximos, una sola vez', async () => {
    const base = (await admin.get('/api/avisos/config')).body.config;
    await admin.put('/api/avisos/config').send({ ...base, clientesVencimientos: true, diasAnticipoVencimiento: 3 }).expect(200);
    const r = await corrida();
    const m = r.mails.filter((x) => x.to === 'venc@c.com');
    expect(m).toHaveLength(1);
    expect(m[0].text).toContain('IVA DDJJ');
    expect(m[0].text).toContain(sumarDias(hoy(), 2).split('-').reverse().join('/'));
    for (const fuera of ['Ganancias lejana', 'Autónomos atrasado', 'Monotributo presentado']) expect(m[0].text).not.toContain(fuera);
    expect((await corrida()).mails.filter((x) => x.to === 'venc@c.com')).toHaveLength(0); // ya avisado
    const venc = (await admin.get(`/api/vencimientos?clienteId=${c.venc}`)).body.find((v) => v.impuesto === 'IVA DDJJ');
    expect(venc.avisadoEn).toBe(hoy());
  });

  it('un fallo de envío no frena a los demás y se reintenta después', async () => {
    const nuevo = (nombre, cuit, email) => admin.post('/api/clientes').send({ razonSocial: nombre, cuit: cuitDe(cuit), condicionIva: 'RI', estado: 'ACTIVO', email }).expect(201);
    const f = (await nuevo('Cli Falla', '2015151515', 'falla@c.com')).body.id;
    const ok = (await nuevo('Cli Ok2', '2013131313', 'ok2@c.com')).body.id;
    for (const id of [f, ok]) await admin.post('/api/vencimientos').send({ clienteId: id, impuesto: 'IVA mañana', periodo: hoy().slice(0, 7), vence: sumarDias(hoy(), 1) }).expect(201);
    fallar.add('falla@c.com');
    const r1 = await corrida();
    expect(r1.errores).toEqual([{ to: 'falla@c.com', error: 'SMTP caído' }]);
    expect(r1.mails.map((m) => m.to)).toContain('ok2@c.com');
    expect((await admin.get(`/api/vencimientos?clienteId=${f}`)).body[0].avisadoEn ?? null).toBeNull(); // no se marcó como avisado
    fallar.clear();
    const r2 = await corrida();
    expect(r2.mails.map((m) => m.to)).toEqual(['falla@c.com']); // reintenta solo el que falló
    expect(r2.errores).toEqual([]);
  });

  it('el cron exige credencial y nunca corre sin CRON_SECRET', async () => {
    delete process.env.CRON_SECRET;
    await request(app).get('/api/cron/avisos').expect(503);
    process.env.CRON_SECRET = 'secreto-cron-de-prueba-123';
    try {
      await request(app).get('/api/cron/avisos').expect(401);
      await request(app).get('/api/cron/avisos').set('Authorization', 'Bearer otro').expect(401);
      await request(app).get('/api/cron/avisos').set('Authorization', `Bearer ${process.env.CRON_SECRET}`.slice(0, -1)).expect(401);
      const r = await request(app).get('/api/cron/avisos').set('Authorization', `Bearer ${process.env.CRON_SECRET}`).expect(200);
      expect(r.body).toMatchObject({ enviados: 0, errores: [] });
    } finally {
      delete process.env.CRON_SECRET;
    }
  });

  it('el historial muestra los envíos y su resultado', async () => {
    const h = (await admin.get('/api/avisos/historial').expect(200)).body;
    expect(h.length).toBeGreaterThan(5);
    expect(h[0]).toHaveProperty('asunto');
    expect(h.every((x) => ['enviado', 'error', 'enviando'].includes(x.estado))).toBe(true);
    expect(JSON.stringify(h)).not.toMatch(/<html/); // no se guarda el contenido de los correos
  });

  it('con un límite de tiempo agotado deja los envíos pendientes sin reclamarlos', async () => {
    const r = await A.ejecutar({ hoy: sumarDias(hoy(), 40), limiteMs: -1 });
    expect(r.enviados).toBe(0);
    expect(r.pendientes).toBeGreaterThan(0);
    const ok = await A.ejecutar({ hoy: sumarDias(hoy(), 40) }); // después sí sale todo
    expect(ok.enviados).toBe(r.pendientes);
  });

  it('sin SMTP configurado avisa con claridad y no rompe', async () => {
    correo.usarTransporteDePrueba(null);
    const guardado = { u: process.env.SMTP_USER, p: process.env.SMTP_PASS };
    delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
    try {
      expect((await admin.get('/api/avisos/config')).body.correo.configurado).toBe(false);
      expect((await admin.post('/api/avisos/prueba').expect(503)).body.error).toContain('SMTP_USER');
      expect((await admin.post('/api/avisos/ejecutar').expect(503)).body.error).toContain('SMTP_USER');
      await admin.get('/api/avisos/vista-previa').expect(200); // la vista previa sí funciona
    } finally {
      if (guardado.u) process.env.SMTP_USER = guardado.u;
      if (guardado.p) process.env.SMTP_PASS = guardado.p;
    }
  });
});

// ---------- Envío SMTP real contra un servidor local de prueba ----------
describe('transporte SMTP real', () => {
  it('entrega un correo bien formado (tildes, HTML y texto) con la autenticación configurada', async () => {
    const { SMTPServer } = require('smtp-server');
    const { simpleParser } = require('mailparser');
    const correo = require('../src/correo/transporte');
    const P = require('../src/correo/plantillas');
    const recibidos = [];
    const servidor = new SMTPServer({
      authOptional: false, allowInsecureAuth: true, disabledCommands: ['STARTTLS'],
      onAuth: (a, _s, cb) => (a.username === 'estudio@gmail.test' && a.password === 'clave-de-app' ? cb(null, { user: a.username }) : cb(new Error('Credenciales inválidas'))),
      onData: (stream, _s, cb) => { simpleParser(stream).then((m) => { recibidos.push(m); cb(); }); },
    });
    await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
    const guardado = { ...process.env };
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(servidor.server.address().port), SMTP_USER: 'estudio@gmail.test', SMTP_PASS: 'clave-de-app', ESTUDIO_NOMBRE: 'Estudio Pérez & Asociados', MAIL_REPLY_TO: 'consultas@estudio.test' });
    correo.usarTransporteDePrueba(null);
    try {
      const m = P.recordatorioVencimientos({ cliente: 'José Núñez <S.A.>', estudio: correo.estudio(), items: [{ impuesto: 'IVA – DDJJ', vence: '2026-10-19', dias: 2 }] });
      await correo.enviar({ to: 'cliente@ejemplo.test', subject: m.subject, html: m.html, text: m.text });
      expect(recibidos).toHaveLength(1);
      const r = recibidos[0];
      expect(r.subject).toBe('Vencimientos próximos - Estudio Pérez & Asociados');
      expect(r.from.value[0]).toMatchObject({ name: 'Estudio Pérez & Asociados', address: 'estudio@gmail.test' });
      expect(r.to.value[0].address).toBe('cliente@ejemplo.test');
      expect(r.replyTo.value[0].address).toBe('consultas@estudio.test');
      expect(r.html).toContain('José Núñez &lt;S.A.&gt;');
      expect(r.html).toContain('vence el 19/10/2026');
      expect(r.text).toContain('IVA – DDJJ: vence el 19/10/2026');
    } finally {
      await new Promise((r) => servidor.close(r));
      for (const k of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'ESTUDIO_NOMBRE', 'MAIL_REPLY_TO']) { if (guardado[k] === undefined) delete process.env[k]; else process.env[k] = guardado[k]; }
    }
  });
});

// ---------- Totales mensuales del Inicio (sin índices ni consultas de suma) ----------
describe('totales mensuales del Inicio', () => {
  const { db: base } = require('../src/db');
  const periodo = hoy().slice(0, 7);
  const c = {};
  const inicio = async () => (await user.get('/api/dashboard').expect(200)).body;
  const totales = async () => { const d = (await inicio()).honorarios; return [d.facturado, d.cobrado]; };

  beforeAll(async () => {
    for (const col of ['clientes', 'cuits', 'honorarios', 'pagos', 'resumenes']) await base.recursiveDelete(base.collection(col));
    await invalidar();
    const nuevo = async (nombre, cuit, abono) => (await admin.post('/api/clientes').send({ razonSocial: nombre, cuit: cuitDe(cuit), condicionIva: 'RI', estado: 'ACTIVO', abonoMensual: abono }).expect(201)).body.id;
    c.a = await nuevo('Tot A', '2016161616', 100000);
    c.b = await nuevo('Tot B', '2017171717', 50000.5);
    await admin.post('/api/honorarios/generar').send({ periodo }).expect(201);
  });

  it('arma los totales solo la primera vez, con lo que ya existía', async () => {
    expect((await base.collection('resumenes').doc('_estado').get()).exists).toBe(false);
    expect(await totales()).toEqual([150000.5, 0]);
    expect((await base.collection('resumenes').doc('_estado').get()).exists).toBe(true);
  });

  it('se mantienen al día con cada cobro, cambio y borrado', async () => {
    const lista = (await admin.get(`/api/honorarios?periodo=${periodo}`)).body.datos;
    const ha = lista.find((h) => h.clienteId === c.a).id;
    const hb = lista.find((h) => h.clienteId === c.b).id;
    const cobrar = (id, monto, fecha) => admin.post(`/api/honorarios/${id}/pagos`).send({ monto, fecha }).expect(201);

    const p1 = (await cobrar(ha, 40000)).body.pago.id;
    await cobrar(hb, 20000.25);
    expect(await totales()).toEqual([150000.5, 60000.25]);

    await admin.patch(`/api/honorarios/${ha}`).send({ monto: 120000 }).expect(200); // sube lo facturado
    expect(await totales()).toEqual([170000.5, 60000.25]);

    await admin.delete(`/api/honorarios/${ha}/pagos/${p1}`).expect(204); // anular un cobro lo descuenta
    expect(await totales()).toEqual([170000.5, 20000.25]);

    // Un cobro con fecha de otro mes cuenta en ESE mes, no en el del honorario
    const previo = `${new Date(Date.UTC(Number(periodo.slice(0, 4)), Number(periodo.slice(5)) - 2, 1)).toISOString().slice(0, 7)}`;
    await cobrar(ha, 10000, `${previo}-15`);
    const d = await inicio();
    expect(d.serie.find((s) => s.periodo === previo).cobrado).toBe(10000);
    expect(d.honorarios.cobrado).toBe(20000.25);

    const nuevo = (await admin.post('/api/honorarios').send({ clienteId: c.a, periodo, concepto: 'Balance', monto: 30000 }).expect(201)).body;
    expect((await totales())[0]).toBe(200000.5);
    await admin.delete(`/api/honorarios/${nuevo.id}`).expect(204);
    expect((await totales())[0]).toBe(170000.5);

    await admin.delete(`/api/honorarios/${ha}`).expect(204); // borra el honorario con su cobro del mes anterior
    const final = await inicio();
    expect(final.honorarios).toMatchObject({ facturado: 50000.5, cobrado: 20000.25 });
    expect(final.serie.find((s) => s.periodo === previo).cobrado).toBe(0);
  });

  it('al borrar un cliente definitivamente se descuentan sus honorarios y cobros', async () => {
    await admin.delete(`/api/clientes/${c.b}?definitivo=true`).expect(204);
    expect((await inicio()).honorarios).toMatchObject({ facturado: 0, cobrado: 0 });
  });

  it('se pueden reparar con "recalcular" (solo administradores)', async () => {
    await admin.post('/api/honorarios').send({ clienteId: c.a, periodo, concepto: 'Extra', monto: 777 }).expect(201);
    await base.collection('resumenes').doc(periodo).set({ facturado: 1, cobrado: 999999 }); // simula un desfasaje
    expect((await inicio()).honorarios).toMatchObject({ facturado: 1, cobrado: 999999 });
    await user.post('/api/dashboard/recalcular').expect(403);
    expect((await admin.post('/api/dashboard/recalcular').expect(200)).body).toMatchObject({ honorarios: 1 });
    expect((await inicio()).honorarios).toMatchObject({ facturado: 777, cobrado: 0 });
  });

  it('si falla un bloque, el Inicio muestra los demás y avisa cuál faltó', async () => {
    const original = base.collection.bind(base);
    base.collection = (n) => { if (n === 'honorarios') throw new Error('falla simulada'); return original(n); };
    try {
      const d = (await user.get('/api/dashboard').expect(200)).body;
      expect(d.avisos).toEqual(['No se pudo cargar: deudores.']);
      expect(d.honorarios).toMatchObject({ deudaTotal: null, topDeudores: [] });
      expect(d.honorarios.facturado).toBe(777); // los totales mensuales no dependen de esa consulta
      expect(d.clientes.activos).toBe(1);
      expect(d.serie).toHaveLength(6);
    } finally {
      base.collection = original;
    }
  });

  it('una consulta que pide índice responde con un mensaje claro y sin filtrar detalles', async () => {
    const original = base.collection.bind(base);
    base.collection = (n) => { if (n === 'tareas') throw Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/x'), { code: 9 }); return original(n); };
    try {
      const r = (await user.get('/api/tareas').expect(500)).body;
      expect(r.error).toMatch(/necesita un índice/);
      expect(r.error).not.toContain('console.firebase.google.com');
    } finally {
      base.collection = original;
    }
  });
});

// ---------- Tareas internas, reasignación y aviso por email ----------
describe('tareas internas, reasignación y aviso por email', () => {
  const correo = require('../src/correo/transporte');
  const A = require('../src/servicios/avisos');
  const enviados = [];
  let fallar = false;
  const u = {};
  const para = (to) => enviados.filter((m) => m.to === to);
  const crear = (cuerpo) => admin.post('/api/tareas').send({ titulo: 'Tarea', vence: hoy(), ...cuerpo });
  const listaDe = async (agente, quien) => (await agente.get(`/api/tareas?asignado=${quien}&dias=30`).expect(200)).body.map((t) => t.titulo);

  beforeAll(async () => {
    correo.usarTransporteDePrueba({ sendMail: async (m) => { if (fallar) throw new Error('SMTP caído'); enviados.push(m); } });
    for (const col of ['tareas', 'envios', 'clientes', 'cuits']) await db.recursiveDelete(db.collection(col));
    await invalidar();
    const usuarios = (await admin.get('/api/usuarios').expect(200)).body;
    u.admin = usuarios.find((x) => x.email === 'admin@t.com').id;
    u.ana = usuarios.find((x) => x.email === 'ana@t.com').id;
    u.luis = usuarios.find((x) => x.email === 'luis@t.com').id;
    const baja = (await admin.post('/api/usuarios').send({ nombre: 'Baja', email: 'baja@t.com', password: 'clave12345', accesoClientes: 'TODOS' }).expect(201)).body;
    await admin.patch(`/api/usuarios/${baja.id}`).send({ activo: false }).expect(200);
    u.baja = baja.id;
    u.cliente = (await admin.post('/api/clientes').send({ razonSocial: 'Cliente de las Tareas' }).expect(201)).body.id;
    await luis_(false); // Luis empieza con los avisos apagados
  });
  afterAll(() => correo.usarTransporteDePrueba(null));
  const luis_ = async (avisos) => { const l = await login('luis@t.com', 'clave12345'); await l.patch('/api/auth/preferencias').send({ avisos }).expect(200); };

  it('el equipo disponible para asignar lista solo a las personas activas', async () => {
    const r = (await user.get('/api/usuarios/equipo').expect(200)).body;
    expect(r.map((x) => x.id).sort()).toEqual([u.admin, u.ana, u.luis].sort());
    expect(r.every((x) => Object.keys(x).sort().join() === 'id,nombre')).toBe(true); // sin datos sensibles
    await request(app).get('/api/usuarios/equipo').expect(401);
  });

  it('crea tareas internas, sin cliente', async () => {
    for (const cuerpo of [{ titulo: 'Renovar el seguro' }, { titulo: 'Renovar la matrícula', clienteId: '' }]) {
      const t = (await crear(cuerpo).expect(201)).body;
      expect(t).toMatchObject({ clienteId: null, clienteNombre: null, asignadoNombre: 'Admin', aviso: null });
    }
    expect(await listaDe(admin, 'yo')).toEqual(expect.arrayContaining(['Renovar el seguro', 'Renovar la matrícula']));
  });

  it('asigna a otra persona, que la ve en su agenda y recibe un email', async () => {
    const t = (await crear({ titulo: 'Presentar IVA de <b>Pérez</b>', clienteId: u.cliente, asignadoA: u.ana, descripcion: 'Con el <script>x</script> de compras' }).expect(201)).body;
    expect(t).toMatchObject({ asignadoA: u.ana, asignadoNombre: 'Ana', clienteNombre: 'Cliente de las Tareas', aviso: 'enviado' });
    expect(await listaDe(user, 'yo')).toContain('Presentar IVA de <b>Pérez</b>');
    expect(await listaDe(admin, u.ana)).toContain('Presentar IVA de <b>Pérez</b>');
    expect(await listaDe(admin, 'yo')).not.toContain('Presentar IVA de <b>Pérez</b>');
    const m = para('ana@t.com')[0];
    expect(m.subject).toBe('Nueva tarea: Presentar IVA de <b>Pérez</b>');
    expect(m.text).toContain('Admin te asignó una tarea');
    expect(m.text).toContain('Cliente: Cliente de las Tareas');
    expect(m.html).toContain('Presentar IVA de &lt;b&gt;Pérez&lt;/b&gt;'); // el HTML va escapado
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('Admin te asignó una tarea');
    u.tarea = t.id;
  });

  it('rechaza responsables o clientes que no existen o están desactivados', async () => {
    expect((await crear({ asignadoA: 'no-existe' }).expect(400)).body.detalles.asignadoA).toBeDefined();
    expect((await crear({ asignadoA: u.baja }).expect(400)).body.detalles.asignadoA[0]).toMatch(/desactivada/);
    expect((await crear({ clienteId: 'no-existe' }).expect(400)).body.detalles.clienteId).toBeDefined();
    await crear({ titulo: 'x' }).expect(400);
    await crear({ vence: '2026-02-31' }).expect(400);
    await admin.patch(`/api/tareas/${u.tarea}`).send({ asignadoA: u.baja }).expect(400);
  });

  it('reasigna: pasa a la agenda del nuevo responsable y avisa solo a esa persona', async () => {
    const antes = enviados.length;
    const r = (await admin.patch(`/api/tareas/${u.tarea}`).send({ asignadoA: u.luis }).expect(200)).body;
    expect(r).toMatchObject({ asignadoA: u.luis, asignadoNombre: 'Luis', aviso: 'desactivado' }); // Luis tiene los avisos apagados
    expect(enviados).toHaveLength(antes);
    expect(await listaDe(admin, u.luis)).toContain('Presentar IVA de <b>Pérez</b>');
    expect(await listaDe(admin, u.ana)).not.toContain('Presentar IVA de <b>Pérez</b>');
    await luis_(true);
    const otra = (await admin.patch(`/api/tareas/${u.tarea}`).send({ asignadoA: u.ana }).expect(200)).body;
    expect(otra.aviso).toBe('enviado');
    expect(para('ana@t.com')).toHaveLength(2); // la original y esta reasignación
  });

  it('editar otros datos no vuelve a avisar, y se puede desvincular o cambiar el cliente', async () => {
    const antes = enviados.length;
    const r = (await user.patch(`/api/tareas/${u.tarea}`).send({ titulo: 'IVA de Pérez (corregido)', descripcion: 'Nueva nota', vence: sumarDias(hoy(), 5) }).expect(200)).body;
    expect(r).toMatchObject({ titulo: 'IVA de Pérez (corregido)', descripcion: 'Nueva nota', vence: sumarDias(hoy(), 5), asignadoNombre: 'Ana', aviso: null });
    await admin.patch(`/api/tareas/${u.tarea}`).send({ asignadoA: u.ana }).expect(200); // mismo responsable
    expect((await admin.patch(`/api/tareas/${u.tarea}`).send({ clienteId: null }).expect(200)).body).toMatchObject({ clienteId: null, clienteNombre: null });
    expect((await admin.patch(`/api/tareas/${u.tarea}`).send({ clienteId: u.cliente }).expect(200)).body.clienteNombre).toBe('Cliente de las Tareas');
    expect(enviados).toHaveLength(antes);
    await admin.patch(`/api/tareas/${u.tarea}`).send({ vence: '2026-13-01' }).expect(400);
    await admin.patch(`/api/tareas/${u.tarea}`).send({ clienteId: 'no-existe' }).expect(400);
    await admin.patch('/api/tareas/no-existe').send({ titulo: 'xx' }).expect(404);
  });

  it('rechaza fechas imposibles (mes 13, día 0, 31 de abril) sin romper el servidor', async () => {
    for (const mala of ['2026-13-01', '2026-00-10', '2026-04-31', '2026-10-00', '26-1-1', 'mañana']) {
      expect((await crear({ vence: mala }).expect(400)).body.detalles.vence).toBeDefined();
    }
    await admin.post('/api/vencimientos').send({ clienteId: u.cliente, impuesto: 'IVA', periodo: '2026-10', vence: '2026-13-45' }).expect(400);
  });

  it('asignarse una tarea a uno mismo no manda email', async () => {
    const antes = enviados.length;
    expect((await user.post('/api/tareas').send({ titulo: 'Mi tarea', vence: hoy(), asignadoA: u.ana }).expect(201)).body.aviso).toBeNull();
    expect(enviados).toHaveLength(antes);
  });

  it('si el correo no está configurado o falla, la tarea se crea igual y se informa', async () => {
    fallar = true;
    const falla = (await crear({ titulo: 'Con SMTP caído', asignadoA: u.ana }).expect(201)).body;
    expect(falla.aviso).toBe('error');
    expect((await admin.get(`/api/tareas?asignado=${u.ana}&dias=30`)).body.some((t) => t.id === falla.id)).toBe(true);
    fallar = false;
    correo.usarTransporteDePrueba(null);
    const guardado = { u: process.env.SMTP_USER, p: process.env.SMTP_PASS };
    delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
    try {
      expect((await crear({ titulo: 'Sin correo', asignadoA: u.ana }).expect(201)).body.aviso).toBe('sin-correo');
    } finally {
      if (guardado.u) process.env.SMTP_USER = guardado.u;
      if (guardado.p) process.env.SMTP_PASS = guardado.p;
      correo.usarTransporteDePrueba({ sendMail: async (m) => { enviados.push(m); } });
    }
  });

  it('el aviso queda en el historial y el resumen diario rotula las tareas internas', async () => {
    const h = await A.historial();
    expect(h.some((x) => x.tipo === 'tarea-asignada' && x.estado === 'enviado' && x.to === 'ana@t.com')).toBe(true);
    expect(h.some((x) => x.tipo === 'tarea-asignada' && x.estado === 'error')).toBe(true);
    await crear({ titulo: 'Interna para el resumen', asignadoA: u.ana }).expect(201);
    const plan = await A.planificar({});
    const m = plan.mensajes.find((x) => x.to === 'ana@t.com');
    expect(m.text).toContain('Interna para el resumen (Tarea interna');
  });

  it('al borrar un cliente se borran sus tareas, pero no las internas', async () => {
    const c = (await admin.post('/api/clientes').send({ razonSocial: 'Cliente a Borrar' }).expect(201)).body.id;
    await crear({ titulo: 'Ligada al cliente', clienteId: c }).expect(201);
    await admin.delete(`/api/clientes/${c}?definitivo=true`).expect(204);
    const mias = await listaDe(admin, 'yo');
    expect(mias).not.toContain('Ligada al cliente');
    expect(mias).toContain('Renovar el seguro');
  });
});

// ---------- Acceso a dinero: oculto para quien no lo tiene, bloqueado en el servidor ----------
describe('acceso a dinero por usuario', () => {
  const { readSheet } = require('read-excel-file/node');
  const A = require('../src/servicios/avisos');
  const periodo = hoy().slice(0, 7);
  const u = {};
  let sin; // usuario común, SIN acceso a montos
  const binario = (res, cb) => { const d = []; res.on('data', (x) => d.push(x)); res.on('end', () => cb(null, Buffer.concat(d))); };
  const bajar = (agente, url) => agente.get(url).buffer(true).parse(binario);
  const darAcceso = (valor) => admin.patch(`/api/usuarios/${u.sin}`).send({ verDinero: valor }).expect(200);

  beforeAll(async () => {
    for (const col of ['clientes', 'cuits', 'honorarios', 'pagos', 'resumenes', 'tareas', 'vencimientos']) await db.recursiveDelete(db.collection(col));
    await invalidar();
    const creado = (await admin.post('/api/usuarios').send({ nombre: 'Contable', email: 'contable@t.com', password: 'clave12345', accesoClientes: 'TODOS' }).expect(201)).body;
    u.sin = creado.id;
    u.creado = creado;
    sin = await login('contable@t.com', 'clave12345');
    u.cli = (await admin.post('/api/clientes').send({ razonSocial: 'Cliente con Abono', cuit: cuitDe('2018181818'), condicionIva: 'RI', estado: 'ACTIVO', abonoMensual: 90000, ciudad: 'Toay' }).expect(201)).body.id;
    await admin.post('/api/honorarios/generar').send({ periodo }).expect(201);
    u.hon = (await admin.get(`/api/honorarios?periodo=${periodo}`)).body.datos[0];
    await admin.post(`/api/honorarios/${u.hon.id}/pagos`).send({ monto: 30000 }).expect(201);
    await admin.post('/api/honorarios').send({ clienteId: u.cli, periodo: '2020-01', concepto: 'Viejo', monto: 5000 }).expect(201);
  });

  it('un usuario nuevo NO tiene acceso a dinero por defecto, y el administrador siempre', async () => {
    expect(u.creado).toMatchObject({ rol: 'USUARIO', verDinero: false });
    expect((await sin.get('/api/auth/me').expect(200)).body).toMatchObject({ verDinero: false });
    expect((await admin.get('/api/auth/me').expect(200)).body).toMatchObject({ rol: 'ADMIN', verDinero: true });
    const lista = (await admin.get('/api/usuarios').expect(200)).body;
    expect(lista.find((x) => x.email === 'admin@t.com').verDinero).toBe(true);
    expect(lista.find((x) => x.email === 'contable@t.com').verDinero).toBe(false);
  });

  it('el servidor bloquea todo lo de honorarios, cobros y deudores', async () => {
    const h = u.hon.id;
    for (const [metodo, url, cuerpo] of [
      ['get', '/api/honorarios'], ['get', `/api/honorarios?periodo=${periodo}`], ['get', `/api/honorarios?clienteId=${u.cli}`], ['get', '/api/honorarios/deudores'],
      ['post', '/api/honorarios', { clienteId: u.cli, periodo, concepto: 'X', monto: 10 }], ['post', '/api/honorarios/generar', { periodo }],
      ['patch', `/api/honorarios/${h}`, { monto: 1 }], ['delete', `/api/honorarios/${h}`],
      ['get', `/api/honorarios/${h}/pagos`], ['post', `/api/honorarios/${h}/pagos`, { monto: 1 }], ['delete', `/api/honorarios/${h}/pagos/x`],
    ]) {
      const r = await sin[metodo](url).send(cuerpo);
      expect([metodo, url, r.status]).toEqual([metodo, url, 403]);
      expect(r.body.error).toMatch(/dinero/);
    }
    expect((await admin.get('/api/honorarios/deudores').expect(200)).body.total).toBeGreaterThan(0);
  });

  it('el Inicio no incluye ni calcula montos para quien no tiene acceso', async () => {
    const d = (await sin.get('/api/dashboard').expect(200)).body;
    expect(d.dinero).toBe(false);
    expect(d.honorarios).toBeNull();
    expect(d.serie).toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/90000|30000|facturado|cobrado|deuda/i);
    expect(d.clientes.total).toBe(1); // lo que no es dinero sigue disponible
    const a = (await admin.get('/api/dashboard').expect(200)).body;
    expect(a.dinero).toBe(true);
    expect(a.honorarios).toMatchObject({ facturado: 90000, cobrado: 30000, deudaTotal: 65000 }); // el mes + los $5.000 de 2020
    expect(a.serie).toHaveLength(6);
  });

  it('el abono mensual del cliente no se ve ni se puede cambiar sin acceso', async () => {
    const lista = (await sin.get('/api/clientes').expect(200)).body.datos;
    expect(lista[0]).not.toHaveProperty('abonoMensual');
    expect((await sin.get(`/api/clientes/${u.cli}`).expect(200)).body).not.toHaveProperty('abonoMensual');
    // intenta editarlo: la respuesta no lo muestra y el valor guardado no cambia
    const put = (await sin.put(`/api/clientes/${u.cli}`).send({ razonSocial: 'Cliente con Abono', cuit: cuitDe('2018181818'), condicionIva: 'RI', estado: 'ACTIVO', ciudad: 'Santa Rosa', abonoMensual: 1 }).expect(200)).body;
    expect(put).not.toHaveProperty('abonoMensual');
    expect(put.ciudad).toBe('Santa Rosa'); // lo demás sí se edita
    expect((await admin.get(`/api/clientes/${u.cli}`)).body.abonoMensual).toBe(90000);
    // al crear un cliente tampoco puede fijarle un abono
    const nuevo = (await sin.post('/api/clientes').send({ razonSocial: 'Cliente de Contable', abonoMensual: 777 }).expect(201)).body;
    expect(nuevo).not.toHaveProperty('abonoMensual');
    expect((await admin.get(`/api/clientes/${nuevo.id}`)).body.abonoMensual ?? null).toBeNull();
    // el archivado también devuelve el cliente sin el abono
    expect((await sin.delete(`/api/clientes/${nuevo.id}`).expect(200)).body).not.toHaveProperty('abonoMensual');
    // el administrador sí lo ve
    expect((await admin.get(`/api/clientes/${u.cli}`)).body.abonoMensual).toBe(90000);
    expect((await admin.get('/api/clientes')).body.datos.find((c) => c.id === u.cli).abonoMensual).toBe(90000);
  });

  it('las exportaciones de dinero están bloqueadas y la de clientes no trae el abono', async () => {
    for (const url of [`/api/exportar/honorarios.xlsx?periodo=${periodo}`, `/api/exportar/honorarios.pdf?periodo=${periodo}`, '/api/exportar/deudores.xlsx', '/api/exportar/deudores.pdf']) {
      await sin.get(url).expect(403);
    }
    const x = await readSheet((await bajar(sin, '/api/exportar/clientes.xlsx').expect(200)).body);
    expect(x[0]).not.toContain('Abono mensual');
    expect(JSON.stringify(x)).not.toContain('90000');
    expect(x[0]).toContain('Ciudad'); // el resto de las columnas sigue
    const csv = (await bajar(sin, '/api/exportar/clientes.csv').expect(200)).body.toString('utf8');
    expect(csv).not.toMatch(/Abono mensual|90000/);
    const adm = await readSheet((await bajar(admin, '/api/exportar/clientes.xlsx').expect(200)).body);
    expect(adm[0]).toContain('Abono mensual');
    expect(adm.some((f) => f.includes(90000))).toBe(true);
  });

  it('el resumen diario por email solo incluye la deuda a quien tiene acceso', async () => {
    await admin.post('/api/tareas').send({ titulo: 'Para que haya resumen', vence: hoy(), asignadoA: u.sin }).expect(201);
    const mensaje = async () => (await A.planificar({})).mensajes.find((m) => m.to === 'contable@t.com');
    expect((await mensaje()).html).not.toContain('Clientes con deuda');
    expect((await mensaje()).text).not.toContain('DEUDA TOTAL');
    await darAcceso(true);
    expect((await mensaje()).html).toContain('Clientes con deuda');
    await darAcceso(false);
    expect((await mensaje()).html).not.toContain('Clientes con deuda');
  });

  it('dar o quitar el acceso surte efecto enseguida, sin volver a iniciar sesión', async () => {
    await sin.get('/api/honorarios/deudores').expect(403);
    expect((await darAcceso(true)).body).toMatchObject({ verDinero: true });
    await sin.get('/api/honorarios/deudores').expect(200);
    expect((await sin.get('/api/dashboard').expect(200)).body.honorarios.deudaTotal).toBeGreaterThan(0);
    expect((await sin.get(`/api/clientes/${u.cli}`)).body.abonoMensual).toBe(90000);
    await bajar(sin, '/api/exportar/deudores.xlsx').expect(200);
    // sigue siendo un usuario común: no puede cobrar de más ni anular cobros (eso es solo de administradores)
    const cobros = (await sin.get(`/api/honorarios/${u.hon.id}/pagos`).expect(200)).body;
    await sin.delete(`/api/honorarios/${u.hon.id}/pagos/${cobros[0].id}`).expect(403);
    await sin.delete(`/api/honorarios/${u.hon.id}`).expect(403);
    await darAcceso(false);
    await sin.get('/api/honorarios/deudores').expect(403);
    expect((await sin.get(`/api/clientes/${u.cli}`)).body).not.toHaveProperty('abonoMensual');
  });

  it('solo un administrador cambia accesos, con datos válidos y no a sí mismo', async () => {
    await sin.patch(`/api/usuarios/${u.sin}`).send({ verDinero: true }).expect(403); // no puede darse acceso
    await user.patch(`/api/usuarios/${u.sin}`).send({ verDinero: true }).expect(403);
    await admin.patch(`/api/usuarios/${u.sin}`).send({}).expect(400);
    await admin.patch(`/api/usuarios/${u.sin}`).send({ verDinero: 'si' }).expect(400);
    await admin.patch(`/api/usuarios/${u.admin ?? (await admin.get('/api/auth/me')).body.id}`).send({ verDinero: false }).expect(400); // a sí mismo
    await admin.patch('/api/usuarios/no-existe').send({ verDinero: true }).expect(404);
    const otro = (await admin.post('/api/usuarios').send({ nombre: 'Socio', email: 'socio@t.com', password: 'clave12345', verDinero: true, accesoClientes: 'TODOS' }).expect(201)).body;
    expect(otro.verDinero).toBe(true); // se puede dar acceso al crearlo
    const socio = await login('socio@t.com', 'clave12345');
    await socio.get('/api/honorarios/deudores').expect(200);
    await socio.post('/api/usuarios').send({ nombre: 'Z', email: 'z@t.com', password: 'clave12345' }).expect(403); // pero no es administrador
  });

  it('desactivar a un usuario cierra su sesión en el acto', async () => {
    await sin.get('/api/clientes').expect(200);
    await admin.patch(`/api/usuarios/${u.sin}`).send({ activo: false }).expect(200);
    await sin.get('/api/clientes').expect(401);
    await sin.get('/api/auth/me').expect(401);
    await request(app).post('/api/auth/login').send({ email: 'contable@t.com', password: 'clave12345' }).expect(401);
    await admin.patch(`/api/usuarios/${u.sin}`).send({ activo: true }).expect(200);
    await sin.get('/api/clientes').expect(200); // reactivado: su sesión vuelve a valer
  });
});

describe('permisos por cliente', () => {
  const { hoy } = require('../src/util');
  const u = {};
  let rita, tomas;
  const nuevoCliente = (agente, razonSocial, extra = {}) => agente.post('/api/clientes').send({ razonSocial, ciudad: 'Ciudad ' + razonSocial, ...extra });

  beforeAll(async () => {
    // por defecto, quien se crea ve solo los clientes que se le asignen
    const r = (await admin.post('/api/usuarios').send({ nombre: 'Rita', email: 'rita@t.com', password: 'clave12345', verDinero: true }).expect(201)).body;
    const t = (await admin.post('/api/usuarios').send({ nombre: 'Tomás', email: 'tomas@t.com', password: 'clave12345' }).expect(201)).body;
    u.rita = r.id; u.tomas = t.id;
    expect(r.todosLosClientes).toBe(false);
    rita = await login('rita@t.com');
    tomas = await login('tomas@t.com');
    u.a = (await nuevoCliente(admin, 'Acceso A', { responsables: [u.rita] }).expect(201)).body.id;
    u.b = (await nuevoCliente(admin, 'Acceso B', { responsables: [u.tomas] }).expect(201)).body.id;
    u.c = (await nuevoCliente(admin, 'Acceso C').expect(201)).body.id;
  });

  it('el usuario nuevo es restringido y el que ya existía conserva todo', async () => {
    expect((await rita.get('/api/auth/me').expect(200)).body.todosLosClientes).toBe(false);
    expect((await user.get('/api/auth/me').expect(200)).body.todosLosClientes).toBe(true);
    expect((await admin.get('/api/auth/me').expect(200)).body.todosLosClientes).toBe(true);
  });

  it('solo ve (y trata como inexistentes) los clientes asignados', async () => {
    const lista = (await rita.get('/api/clientes').expect(200)).body;
    expect(lista.datos.map((c) => c.razonSocial)).toEqual(['Acceso A']);
    expect(lista.datos[0]).not.toHaveProperty('responsables');
    expect((await rita.get('/api/clientes/ciudades').expect(200)).body).toEqual(['Ciudad Acceso A']);
    await rita.get(`/api/clientes/${u.a}`).expect(200);
    await rita.get(`/api/clientes/${u.b}`).expect(404);
    await rita.put(`/api/clientes/${u.b}`).send({ razonSocial: 'Hack', estado: 'POTENCIAL', etiquetas: [] }).expect(404);
    await rita.delete(`/api/clientes/${u.b}`).expect(404);
    await rita.get(`/api/clientes/${u.b}/interacciones`).expect(404);
    await rita.post(`/api/clientes/${u.b}/interacciones`).send({ tipo: 'LLAMADA', detalle: 'x' }).expect(404);
    expect((await admin.get('/api/clientes').expect(200)).body.total).toBeGreaterThan(3);
  });

  it('el administrador ve y cambia los responsables; los demás no', async () => {
    expect((await admin.get(`/api/clientes/${u.a}`).expect(200)).body.responsables).toEqual([u.rita]);
    const dato = { razonSocial: 'Acceso A', estado: 'POTENCIAL', etiquetas: [] };
    // la persona limitada no puede darse acceso a otros clientes ni quitárselo a otros
    const r = await rita.put(`/api/clientes/${u.a}`).send({ ...dato, responsables: [u.tomas] }).expect(200);
    expect(r.body).not.toHaveProperty('responsables');
    expect((await admin.get(`/api/clientes/${u.a}`).expect(200)).body.responsables).toEqual([u.rita]);
    await admin.put(`/api/clientes/${u.a}`).send({ ...dato, responsables: ['no-existe'] }).expect(400);
    await admin.put(`/api/clientes/${u.a}`).send({ ...dato, responsables: [u.rita, u.tomas] }).expect(200);
    await tomas.get(`/api/clientes/${u.a}`).expect(200);
    await admin.put(`/api/clientes/${u.a}`).send({ ...dato, responsables: [u.rita] }).expect(200);
    await tomas.get(`/api/clientes/${u.a}`).expect(404);
  });

  it('el cliente que crea una persona limitada queda a su nombre; el de acceso total, sin responsables', async () => {
    const d = (await nuevoCliente(rita, 'Creado por Rita', { responsables: [u.tomas] }).expect(201)).body;
    await rita.get(`/api/clientes/${d.id}`).expect(200);
    expect((await admin.get(`/api/clientes/${d.id}`).expect(200)).body.responsables).toEqual([u.rita]);
    await tomas.get(`/api/clientes/${d.id}`).expect(404);
    const e = (await nuevoCliente(user, 'Creado por Ana').expect(201)).body;
    expect((await admin.get(`/api/clientes/${e.id}`).expect(200)).body.responsables).toEqual([]);
    await rita.get(`/api/clientes/${e.id}`).expect(404);
  });

  it('se asigna también desde la ficha de la persona (mismos datos, otro lado)', async () => {
    expect((await admin.get(`/api/usuarios/${u.tomas}/clientes`).expect(200)).body.map((c) => c.razonSocial)).toEqual(['Acceso B']);
    const r = (await admin.put(`/api/usuarios/${u.tomas}/clientes`).send({ clienteIds: [u.b, u.c] }).expect(200)).body;
    expect(r).toEqual({ asignados: 2, agregados: 1, quitados: 0 });
    expect((await admin.get(`/api/clientes/${u.c}`).expect(200)).body.responsables).toEqual([u.tomas]);
    await tomas.get(`/api/clientes/${u.c}`).expect(200);
    await admin.put(`/api/usuarios/${u.tomas}/clientes`).send({ clienteIds: [u.b] }).expect(200);
    await tomas.get(`/api/clientes/${u.c}`).expect(404);
    await admin.put(`/api/usuarios/${u.tomas}/clientes`).send({ clienteIds: ['no-existe'] }).expect(400);
    await rita.get(`/api/usuarios/${u.tomas}/clientes`).expect(403);
    await rita.put(`/api/usuarios/${u.tomas}/clientes`).send({ clienteIds: [u.a] }).expect(403);
  });

  it('no se puede asignar una tarea de un cliente a quien no lo ve', async () => {
    const base = { clienteId: u.a, titulo: 'Presentar balance', vence: hoy() };
    const r = await rita.post('/api/tareas').send({ ...base, asignadoA: u.tomas }).expect(400);
    expect(r.body.detalles.asignadoA[0]).toMatch(/acceso/i);
    await rita.post('/api/tareas').send({ clienteId: u.b, titulo: 'Ajena', vence: hoy() }).expect(400); // ni sobre un cliente que ella no ve
    const propia = (await rita.post('/api/tareas').send(base).expect(201)).body;
    await rita.patch(`/api/tareas/${propia.id}`).send({ asignadoA: u.tomas }).expect(400);
    // dándole acceso primero, sí
    await admin.put(`/api/usuarios/${u.tomas}/clientes`).send({ clienteIds: [u.a, u.b] }).expect(200);
    await rita.patch(`/api/tareas/${propia.id}`).send({ asignadoA: u.tomas }).expect(200);
    expect((await tomas.get('/api/tareas?asignado=yo').expect(200)).body.map((t) => t.id)).toContain(propia.id);
    // las tareas internas (sin cliente) se pueden dar a cualquiera
    await rita.post('/api/tareas').send({ titulo: 'Interna', vence: hoy(), asignadoA: u.tomas }).expect(201);
    // y quitarle el acceso la saca de su agenda y de las consultas por cliente
    await admin.put(`/api/usuarios/${u.tomas}/clientes`).send({ clienteIds: [u.b] }).expect(200);
    expect((await tomas.get('/api/tareas?asignado=yo').expect(200)).body.map((t) => t.id)).not.toContain(propia.id);
    await tomas.get(`/api/tareas?clienteId=${u.a}`).expect(404);
    await tomas.patch(`/api/tareas/${propia.id}`).send({ hecha: true }).expect(404);
  });

  it('vencimientos, agenda y pendientes urgentes solo de sus clientes', async () => {
    const ayer = require('../src/util').sumarDias(hoy(), -1);
    const va = (await admin.post('/api/vencimientos').send({ clienteId: u.a, impuesto: 'IVA', periodo: '2020-01', vence: ayer }).expect(201)).body;
    const vb = (await admin.post('/api/vencimientos').send({ clienteId: u.b, impuesto: 'IVA', periodo: '2020-01', vence: ayer }).expect(201)).body;
    expect((await rita.get('/api/vencimientos').expect(200)).body.map((v) => v.id)).toEqual([va.id]);
    await rita.get(`/api/vencimientos?clienteId=${u.b}`).expect(404);
    await rita.post('/api/vencimientos').send({ clienteId: u.b, impuesto: 'Ganancias', periodo: '2020-02', vence: ayer }).expect(400);
    await rita.patch(`/api/vencimientos/${vb.id}`).send({ estado: 'PRESENTADO' }).expect(404);
    await rita.delete(`/api/vencimientos/${vb.id}`).expect(404);
    const al = (await rita.get('/api/alertas').expect(200)).body;
    expect(al.vencimientos.vencidos).toBe(1);
    const todo = (await admin.get('/api/alertas').expect(200)).body;
    expect(todo.vencimientos.vencidos).toBeGreaterThanOrEqual(2);
    await rita.post('/api/calendarios/2020-01/aplicar').expect(403);
  });

  it('honorarios, deudores, documentos, Inicio y exportaciones solo de sus clientes', async () => {
    const ha = (await admin.post('/api/honorarios').send({ clienteId: u.a, periodo: '2020-03', concepto: 'Balance A', monto: 1000 }).expect(201)).body;
    const hb = (await admin.post('/api/honorarios').send({ clienteId: u.b, periodo: '2020-03', concepto: 'Balance B', monto: 2000 }).expect(201)).body;
    const lista = (await rita.get('/api/honorarios').expect(200)).body;
    expect(lista.datos.map((h) => h.id)).toEqual([ha.id]);
    expect(lista.totales.saldo).toBe(1000);
    expect((await rita.get('/api/honorarios/deudores').expect(200)).body.datos.map((d) => d.clienteId)).toEqual([u.a]);
    await rita.get(`/api/honorarios?clienteId=${u.b}`).expect(404);
    await rita.post('/api/honorarios').send({ clienteId: u.b, periodo: '2020-04', concepto: 'Otro', monto: 5 }).expect(400);
    await rita.get(`/api/honorarios/${hb.id}/pagos`).expect(404);
    await rita.post(`/api/honorarios/${hb.id}/pagos`).send({ monto: 100 }).expect(404);
    await rita.patch(`/api/honorarios/${hb.id}`).send({ monto: 1 }).expect(404);
    await rita.post(`/api/honorarios/${ha.id}/pagos`).send({ monto: 100 }).expect(201);
    await rita.post('/api/honorarios/generar').send({ periodo: '2020-05' }).expect(403);
    await rita.get(`/api/documentos?clienteId=${u.b}`).expect(404);
    await rita.get(`/api/documentos?clienteId=${u.a}`).expect(200);

    const d = (await rita.get('/api/dashboard').expect(200)).body;
    expect(d.dinero).toBe(false); // los totales del estudio no son para quien ve solo algunos clientes
    expect(d.clientes.total).toBe(2); // Acceso A y Creado por Rita
    expect(JSON.stringify(d)).not.toMatch(/Balance|deuda/i);

    const csv = (await rita.get('/api/exportar/clientes.csv').expect(200)).text;
    expect(csv).toContain('Acceso A');
    expect(csv).not.toContain('Acceso B');
    await rita.get('/api/exportar/deudores.xlsx').expect(200);
  });

  it('la Agenda del equipo entero es solo para administradores', async () => {
    const ajena = (await admin.post('/api/tareas').send({ titulo: 'Tarea de Tomás', vence: hoy(), asignadoA: u.tomas }).expect(201)).body;
    const ids = (r) => r.body.map((t) => t.id);
    expect(ids(await rita.get('/api/tareas').expect(200))).not.toContain(ajena.id); // sin filtro: solo las suyas
    expect(ids(await rita.get(`/api/tareas?asignado=${u.tomas}`).expect(200))).not.toContain(ajena.id);
    expect(ids(await admin.get('/api/tareas').expect(200))).toContain(ajena.id);
    expect(ids(await admin.get(`/api/tareas?asignado=${u.tomas}`).expect(200))).toContain(ajena.id);
  });

  it('el resumen por email trae solo lo de sus clientes', async () => {
    const { planificar } = require('../src/servicios/avisos');
    const plan = await planificar({ hoy: hoy() });
    const m = plan.mensajes.find((x) => x.tipo === 'equipo' && x.to === 'rita@t.com');
    expect(m.html).toContain('Acceso A');
    expect(m.html).not.toContain('Acceso B');
  });

  it('pasar a "todos los clientes" (y volver) surte efecto enseguida', async () => {
    await admin.patch(`/api/usuarios/${u.rita}`).send({ accesoClientes: 'TODOS' }).expect(200);
    expect((await rita.get('/api/clientes').expect(200)).body.total).toBeGreaterThan(3);
    expect((await rita.get('/api/auth/me').expect(200)).body.todosLosClientes).toBe(true);
    await admin.patch(`/api/usuarios/${u.rita}`).send({ accesoClientes: 'ASIGNADOS' }).expect(200);
    await rita.get(`/api/clientes/${u.b}`).expect(404);
    expect((await admin.get('/api/usuarios').expect(200)).body.find((x) => x.id === u.rita)).toMatchObject({ todosLosClientes: false });
  });
});
