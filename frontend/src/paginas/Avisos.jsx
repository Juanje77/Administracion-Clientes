import { useEffect, useState } from 'react';
import { api } from '../api';
import Alerta from '../componentes/Alerta';

const TIPOS = { equipo: 'Resumen al equipo', 'cliente-deuda': 'Recordatorio de deuda', 'cliente-vencimientos': 'Recordatorio de vencimientos' };
const ESTADO = { enviado: ['Enviado', 'insignia-gris'], error: ['Error', 'insignia-negra'], enviando: ['Enviando', 'insignia-linea'] };
const fecha = (d) => new Date(d).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

function Interruptor({ checked, onChange, titulo, detalle }) {
  return (
    <label className="flex items-start gap-3 rounded-panel border p-4 text-sm">
      <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><strong className="block">{titulo}</strong><span className="text-machine">{detalle}</span></span>
    </label>
  );
}

export default function Avisos() {
  const [datos, setDatos] = useState(null);
  const [config, setConfig] = useState(null);
  const [historial, setHistorial] = useState([]);
  const [vista, setVista] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState('');

  const cargar = async () => {
    try {
      const d = await api('/avisos/config');
      setDatos(d); setConfig(d.config);
      setHistorial(await api('/avisos/historial'));
    } catch (ex) { setMsg({ ok: false, texto: ex.message }); }
  };
  useEffect(() => { cargar(); }, []);

  async function accion(nombre, fn, exito) {
    setMsg(null); setOcupado(nombre);
    try { const r = await fn(); if (exito) setMsg({ ok: true, texto: exito(r) }); return r; }
    catch (ex) { setMsg({ ok: false, texto: Object.values(ex.detalles || {}).flat()[0] || ex.message }); }
    finally { setOcupado(''); }
  }

  const guardar = () => accion('guardar', () => api('/avisos/config', { metodo: 'PUT', cuerpo: config }), () => 'Configuración guardada').then(cargar);
  const prueba = () => accion('prueba', () => api('/avisos/prueba', { metodo: 'POST' }), (r) => `Correo de prueba enviado a ${r.a}. Revisa tu bandeja (y la carpeta de spam).`).then(cargar);
  const previa = () => accion('previa', () => api('/avisos/vista-previa')).then((r) => r && setVista(r));
  async function ejecutar() {
    if (!confirm('Se enviarán ahora los avisos que correspondan hoy (no se repite lo ya enviado). ¿Continuar?')) return;
    const r = await accion('ejecutar', () => api('/avisos/ejecutar', { metodo: 'POST' }),
      (x) => `Enviados: ${x.enviados}. Ya enviados antes: ${x.yaEnviados}.${x.pendientes ? ` Quedaron ${x.pendientes} para la próxima ejecución.` : ''}${x.errores.length ? ` Con error: ${x.errores.length}.` : ''}`);
    if (r) { setVista(null); cargar(); }
  }

  if (!config) return msg ? <Alerta tipo="error">{msg.texto}</Alerta> : <p className="text-machine">Cargando…</p>;
  const cambiar = (k) => (v) => setConfig({ ...config, [k]: v });
  const sinCorreo = !datos.correo.configurado;

  return (
    <div className="space-y-6">
      <h1 className="titulo-pagina">Avisos por email</h1>

      <section className={`rounded-panel border p-4 text-sm ${sinCorreo ? 'border-figure bg-figure/5' : ''}`}>
        {sinCorreo ? (
          <p><strong>El correo todavía no está configurado.</strong> Faltan las variables <code>SMTP_USER</code> y <code>SMTP_PASS</code> en el servidor (ver README, sección “Avisos por email”). Mientras tanto puedes ver la vista previa, pero no enviar.</p>
        ) : (
          <p><strong>Correo configurado.</strong> Los avisos salen desde <code>{datos.correo.remitente}</code>.</p>
        )}
        <p className="mt-1">{datos.cron.configurado ? 'El envío automático diario está habilitado (de lunes a viernes, 8:00 hs).' : 'El envío automático diario no está habilitado: falta la variable CRON_SECRET. Puedes enviar manualmente con “Enviar ahora”.'}</p>
      </section>

      <section className="space-y-3 panel">
        <h2 className="titulo-seccion">Qué se envía</h2>
        <Interruptor checked={config.equipoActivo} onChange={cambiar('equipoActivo')} titulo="Resumen diario al equipo"
          detalle="Cada integrante recibe sus tareas y los vencimientos pendientes; los administradores, también los deudores. Solo se envía si hay algo pendiente. Cada persona puede desactivarlo en “Mi cuenta”." />
        <Interruptor checked={config.clientesVencimientos} onChange={cambiar('clientesVencimientos')} titulo="Recordatorio de vencimientos a los clientes"
          detalle="Un email al cliente con sus vencimientos próximos. Se avisa una sola vez por vencimiento." />
        {config.clientesVencimientos && (
          <label className="ml-7 flex items-center gap-2 text-sm">Avisar con <input type="number" min="1" max="15" className="campo w-20" value={config.diasAnticipoVencimiento} onChange={(e) => cambiar('diasAnticipoVencimiento')(e.target.value)} /> días de anticipo</label>
        )}
        <Interruptor checked={config.clientesDeuda} onChange={cambiar('clientesDeuda')} titulo="Recordatorio de honorarios pendientes a los clientes"
          detalle="Un email al cliente con los honorarios atrasados (meses anteriores). Se repite como máximo cada cierta cantidad de días." />
        {config.clientesDeuda && (
          <div className="ml-7 space-y-2">
            <label className="flex items-center gap-2 text-sm">Repetir cada <input type="number" min="1" max="90" className="campo w-20" value={config.diasEntreAvisosDeuda} onChange={(e) => cambiar('diasEntreAvisosDeuda')(e.target.value)} /> días</label>
            <label className="block text-sm">
              <span className="etiqueta-label">Texto para el cliente (cómo pagar: CBU, alias, etc.)</span>
              <textarea rows={3} className="campo" value={config.textoPago} onChange={(e) => cambiar('textoPago')(e.target.value)} placeholder="Podés abonar por transferencia al alias estudio.contable…" />
            </label>
          </div>
        )}
        <p className="text-xs text-machine">Los clientes solo reciben avisos si están <strong>activos</strong>, tienen <strong>email</strong> y su casilla de recordatorios está marcada (en la ficha de cada cliente).</p>
        <button className="btn-primario" onClick={guardar} disabled={ocupado === 'guardar'}>Guardar configuración</button>
      </section>

      {msg && <Alerta tipo={msg.ok ? 'ok' : 'error'}>{msg.texto}</Alerta>}

      <section className="space-y-3 panel">
        <h2 className="titulo-seccion">Probar antes de enviar</h2>
        <div className="flex flex-wrap gap-2">
          <button className="btn-sec" onClick={prueba} disabled={sinCorreo || !!ocupado}>Enviarme un correo de prueba</button>
          <button className="btn-sec" onClick={previa} disabled={!!ocupado}>Ver qué se enviaría hoy</button>
          <button className="btn-primario" onClick={ejecutar} disabled={sinCorreo || !!ocupado}>Enviar ahora</button>
        </div>
        <p className="text-xs text-machine">La configuración que ves arriba debe estar <em>guardada</em> para que la vista previa y el envío la usen.</p>
        {vista && (
          <div className="rounded-panel border p-4 text-sm">
            <p className="font-medium">Hoy se enviarían {vista.total} correos {vista.total === 0 && '(nada pendiente)'}</p>
            <ul className="mt-2 divide-y">
              {vista.mensajes.map((m, i) => (
                <li key={i} className="py-1.5">
                  <span className="font-medium">{m.destino}</span> <span className="text-machine">&lt;{m.to}&gt;</span>
                  <span className="block text-xs text-machine">{TIPOS[m.tipo]} · {m.detalle}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="titulo-seccion mb-3">Últimos envíos</h2>
        <ul className="divide-y text-sm">
          {historial.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className={ESTADO[h.estado]?.[1]}>{ESTADO[h.estado]?.[0] ?? h.estado}</span>
              <span className="min-w-0 flex-1"><span className="font-medium">{h.destino}</span> <span className="text-machine">· {TIPOS[h.tipo] ?? h.tipo}</span>
                {h.error && <span className="block text-xs text-figure">{h.error}</span>}</span>
              <span className="text-xs text-machine">{fecha(h.creadoEn)}</span>
            </li>
          ))}
          {historial.length === 0 && <li className="py-4 text-center text-machine">Todavía no se envió ningún aviso.</li>}
        </ul>
      </section>
    </div>
  );
}
