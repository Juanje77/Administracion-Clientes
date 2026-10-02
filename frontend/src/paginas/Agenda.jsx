import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { verFecha } from '../fechas';
import Situacion from '../componentes/Situacion';
import { FilaTarea, FormularioTarea, avisarAlertas, textoAviso, useEquipo } from '../componentes/Tareas';

function Resumen({ titulo, valor, color }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className={`text-2xl font-semibold ${valor ? color : 'text-slate-400'}`}>{valor}</p>
    </div>
  );
}

export default function Agenda() {
  const [tareas, setTareas] = useState([]);
  const [venc, setVenc] = useState([]);
  const equipo = useEquipo();
  const [responsable, setResponsable] = useState('yo'); // 'yo' | 'todos' | id de una persona
  const [dias, setDias] = useState(7);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const cargar = () => {
    api(`/tareas?dias=${dias}${responsable === 'todos' ? '' : `&asignado=${responsable}`}`).then(setTareas).catch((e) => setError(e.message));
    api(`/vencimientos?dias=${dias}`).then(setVenc).catch((e) => setError(e.message));
    avisarAlertas();
  };
  useEffect(cargar, [responsable, dias]);
  const guardado = (r) => { setCreando(false); setEditando(null); setMsg(textoAviso(r)); cargar(); };

  const completar = async (t) => { await api(`/tareas/${t.id}`, { metodo: 'PATCH', cuerpo: { hecha: true } }); cargar(); };
  const presentar = async (v) => { await api(`/vencimientos/${v.id}`, { metodo: 'PATCH', cuerpo: { estado: 'PRESENTADO' } }); cargar(); };

  const cuenta = (lista, s) => lista.filter((x) => x.situacion === s).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Agenda</h1>
        <label className="flex items-center gap-2 text-sm">
          Mostrar vencido y próximos
          <select className="campo w-28" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={7}>7 días</option>
            <option value={15}>15 días</option>
            <option value={30}>30 días</option>
          </select>
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Resumen titulo="Tareas vencidas" valor={cuenta(tareas, 'VENCIDA')} color="text-red-600" />
        <Resumen titulo="Tareas para hoy" valor={cuenta(tareas, 'HOY')} color="text-orange-600" />
        <Resumen titulo="Vencimientos vencidos" valor={cuenta(venc, 'VENCIDA')} color="text-red-600" />
        <Resumen titulo="Vencen pronto" valor={cuenta(venc, 'HOY') + cuenta(venc, 'PROXIMA')} color="text-amber-600" />
      </div>

      <section className="space-y-3 rounded-lg border bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Tareas pendientes</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select className="campo w-44" value={responsable} onChange={(e) => setResponsable(e.target.value)} aria-label="Ver tareas de">
              <option value="yo">Mis tareas</option>
              <option value="todos">Todo el equipo</option>
              {equipo.map((p) => <option key={p.id} value={p.id}>Tareas de {p.nombre}</option>)}
            </select>
            {!creando && <button className="btn-primario" onClick={() => { setCreando(true); setEditando(null); setMsg(''); }}>+ Nueva tarea</button>}
          </div>
        </div>
        {creando && <FormularioTarea equipo={equipo} alGuardar={guardado} alCancelar={() => setCreando(false)} />}
        {msg && <p role="status" className="text-sm text-green-700">{msg}</p>}
        <ul className="divide-y">
          {tareas.map((t) => (
            <li key={t.id} className="space-y-2 py-2">
              <FilaTarea tarea={t} mostrarResponsable={responsable !== 'yo'} alCompletar={completar}
                alEditar={() => { setEditando(editando === t.id ? null : t.id); setCreando(false); setMsg(''); }} />
              {editando === t.id && <FormularioTarea tarea={t} equipo={equipo} alGuardar={guardado} alCancelar={() => setEditando(null)} />}
            </li>
          ))}
          {tareas.length === 0 && <li className="py-4 text-center text-sm text-slate-500">No hay tareas pendientes en este período. 🎉</li>}
        </ul>
      </section>

      <section className="space-y-3 rounded-lg border bg-white p-4 sm:p-6">
        <h2 className="font-semibold">Vencimientos impositivos pendientes</h2>
        <p className="text-sm text-slate-600">
          Los vencimientos del mes se generan desde el <Link className="text-blue-700 hover:underline" to="/calendario">Calendario impositivo</Link>.
        </p>
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
          {venc.length === 0 && <li className="py-4 text-center text-sm text-slate-500">No hay vencimientos pendientes en este período.</li>}
          {venc.length >= 500 && <li className="py-3 text-center text-xs text-amber-700">Se muestran los primeros 500; reduce el período para ver el resto.</li>}
        </ul>
      </section>
    </div>
  );
}
