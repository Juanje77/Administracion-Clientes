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
    for (const col of ['clientes', 'cuits', 'honorarios']) await db.recursiveDelete(db.collection(col));
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
