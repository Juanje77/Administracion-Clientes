import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { verFecha } from '../fechas';
import Situacion from '../componentes/Situacion';
import { avisarAlertas } from '../componentes/TareasCliente';

const GRUPOS = ['0-1', '2-3', '4-5', '6-7', '8-9'];
const mesActual = () => new Date().toLocaleDateString('en-CA').slice(0, 7);

function Resumen({ titulo, valor, color }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className={`text-2xl font-semibold ${valor ? color : 'text-slate-400'}`}>{valor}</p>
    </div>
  );
}

function GenerarVencimientos({ alTerminar }) {
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({ impuesto: '', periodo: mesActual(), etiqueta: '', incluirInactivos: false });
  const [fechas, setFechas] = useState({});
  const [etiquetas, setEtiquetas] = useState([]);
  const [msg, setMsg] = useState(null);

  useEffect(() => { if (abierto) api('/clientes/etiquetas').then(setEtiquetas).catch(() => {}); }, [abierto]);

  async function generar(e) {
    e.preventDefault();
    setMsg(null);
    const fechasLimpias = Object.fromEntries(Object.entries(fechas).filter(([, v]) => v));
    try {
      const r = await api('/vencimientos/generar', { metodo: 'POST', cuerpo: { ...f, fechas: fechasLimpias } });
      setMsg({ ok: true, texto: `Creados: ${r.creados}. Ya existían: ${r.yaExistian}.${r.sinCuit.length ? ` Sin CUIT válido (omitidos): ${r.sinCuit.join(', ')}.` : ''}` });
      alTerminar();
    } catch (ex) {
      setMsg({ ok: false, texto: Object.values(ex.detalles || {}).flat()[0] || ex.message });
    }
  }

  if (!abierto) return <button className="btn-sec" onClick={() => setAbierto(true)}>+ Generar vencimientos del mes</button>;
  return (
    <form onSubmit={generar} className="space-y-3 rounded-lg border bg-white p-4">
      <p className="text-sm text-slate-600">
        Crea el mismo vencimiento para todos los clientes activos. Carga la fecha que indica el calendario
        impositivo para cada terminación de CUIT; las que dejes vacías se omiten.
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        <input className="campo" required placeholder="Impuesto" value={f.impuesto} onChange={(e) => setF({ ...f, impuesto: e.target.value })} aria-label="Impuesto" />
        <input className="campo" required type="month" value={f.periodo} onChange={(e) => setF({ ...f, periodo: e.target.value })} aria-label="Período" />
        <select className="campo" value={f.etiqueta} onChange={(e) => setF({ ...f, etiqueta: e.target.value })} aria-label="Etiqueta">
          <option value="">Todos los clientes activos</option>
          {etiquetas.map((t) => <option key={t.id} value={t.nombre}>Solo etiqueta: {t.nombre}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.incluirInactivos} onChange={(e) => setF({ ...f, incluirInactivos: e.target.checked })} /> Incluir inactivos
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-5">
        {GRUPOS.map((g) => (
          <div key={g}>
            <label className="etiqueta-label">CUIT termina en {g}</label>
            <input type="date" className="campo" value={fechas[g] || ''} onChange={(e) => setFechas({ ...fechas, [g]: e.target.value })} />
          </div>
        ))}
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.texto}</p>}
      <div className="flex gap-2">
        <button className="btn-primario">Generar</button>
        <button type="button" className="btn-sec" onClick={() => setAbierto(false)}>Cerrar</button>
      </div>
    </form>
  );
}

export default function Agenda() {
  const [tareas, setTareas] = useState([]);
  const [venc, setVenc] = useState([]);
  const [soloMias, setSoloMias] = useState(true);
  const [error, setError] = useState('');

  const cargar = () => {
    api(`/tareas${soloMias ? '?asignado=yo' : ''}`).then(setTareas).catch((e) => setError(e.message));
    api('/vencimientos').then(setVenc).catch((e) => setError(e.message));
    avisarAlertas();
  };
  useEffect(cargar, [soloMias]);

  const completar = async (t) => { await api(`/tareas/${t.id}`, { metodo: 'PATCH', cuerpo: { hecha: true } }); cargar(); };
  const presentar = async (v) => { await api(`/vencimientos/${v.id}`, { metodo: 'PATCH', cuerpo: { estado: 'PRESENTADO' } }); cargar(); };

  const cuenta = (lista, s) => lista.filter((x) => x.situacion === s).length;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Agenda</h1>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Resumen titulo="Tareas vencidas" valor={cuenta(tareas, 'VENCIDA')} color="text-red-600" />
        <Resumen titulo="Tareas para hoy" valor={cuenta(tareas, 'HOY')} color="text-orange-600" />
        <Resumen titulo="Vencimientos vencidos" valor={cuenta(venc, 'VENCIDA')} color="text-red-600" />
        <Resumen titulo="Vencen en 7 días" valor={cuenta(venc, 'HOY') + cuenta(venc, 'PROXIMA')} color="text-amber-600" />
      </div>

      <section className="rounded-lg border bg-white p-4 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Tareas pendientes</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={soloMias} onChange={(e) => setSoloMias(e.target.checked)} /> Solo las mías
          </label>
        </div>
        <ul className="divide-y">
          {tareas.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
              <input type="checkbox" onChange={() => completar(t)} aria-label={`Completar ${t.titulo}`} className="h-4 w-4" />
              <div className="flex-1">
                {t.titulo}
                <span className="block text-xs text-slate-500">
                  <Link className="text-blue-700 hover:underline" to={`/clientes/${t.clienteId}`}>{t.clienteNombre}</Link>
                  {' · '}{verFecha(t.vence)}{!soloMias && ` · ${t.asignadoNombre || 'Sin asignar'}`}
                </span>
              </div>
              <Situacion valor={t.situacion} />
            </li>
          ))}
          {tareas.length === 0 && <li className="py-4 text-center text-sm text-slate-500">No tienes tareas pendientes. 🎉</li>}
        </ul>
      </section>

      <section className="space-y-3 rounded-lg border bg-white p-4 sm:p-6">
        <h2 className="font-semibold">Vencimientos impositivos pendientes</h2>
        <GenerarVencimientos alTerminar={cargar} />
        <ul className="divide-y">
          {venc.map((v) => (
            <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="flex-1">
                {v.impuesto} <span className="text-slate-500">· {v.periodo}</span>
                <span className="block text-xs text-slate-500">
                  <Link className="text-blue-700 hover:underline" to={`/clientes/${v.clienteId}`}>{v.clienteNombre}</Link>
                  {' · vence '}{verFecha(v.vence)}
                </span>
              </div>
              <Situacion valor={v.situacion} />
              <button className="btn-sec" onClick={() => presentar(v)}>Presentado</button>
            </li>
          ))}
          {venc.length === 0 && <li className="py-4 text-center text-sm text-slate-500">No hay vencimientos pendientes.</li>}
        </ul>
      </section>
    </div>
  );
}
