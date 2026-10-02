import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { verFecha } from '../fechas';
import Situacion from './Situacion';

export const avisarAlertas = () => window.dispatchEvent(new Event('alertas'));

export default function TareasCliente({ clienteId }) {
  const { usuario } = useAuth();
  const [tareas, setTareas] = useState([]);
  const [equipo, setEquipo] = useState([]);
  const [f, setF] = useState({ titulo: '', vence: '', asignadoA: usuario.id });
  const [error, setError] = useState('');

  const cargar = () => api(`/tareas?clienteId=${clienteId}`).then(setTareas).catch((e) => setError(e.message));
  useEffect(() => { cargar(); api('/usuarios/equipo').then(setEquipo).catch(() => {}); }, [clienteId]);

  async function agregar(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/tareas', { metodo: 'POST', cuerpo: { ...f, clienteId } });
      setF({ ...f, titulo: '', vence: '' });
      cargar(); avisarAlertas();
    } catch (ex) {
      setError(Object.values(ex.detalles || {}).flat()[0] || ex.message);
    }
  }
  const alternar = async (t) => { await api(`/tareas/${t.id}`, { metodo: 'PATCH', cuerpo: { hecha: !t.hecha } }); cargar(); avisarAlertas(); };
  const borrar = async (t) => {
    if (!confirm('¿Borrar esta tarea?')) return;
    try { await api(`/tareas/${t.id}`, { metodo: 'DELETE' }); cargar(); avisarAlertas(); } catch (ex) { setError(ex.message); }
  };

  return (
    <section className="rounded-lg border bg-white p-4 sm:p-6">
      <h2 className="mb-3 font-semibold">Tareas y recordatorios</h2>
      <form onSubmit={agregar} className="mb-4 grid gap-2 sm:grid-cols-[1fr_9rem_10rem_auto]">
        <input className="campo" required placeholder="Tarea (ej. Pedir facturas de agosto)" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} aria-label="Tarea" />
        <input className="campo" required type="date" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} aria-label="Fecha límite" />
        <select className="campo" value={f.asignadoA} onChange={(e) => setF({ ...f, asignadoA: e.target.value })} aria-label="Asignar a">
          {equipo.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        <button className="btn-primario">Agregar</button>
      </form>
      {error && <p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}
      <ul className="divide-y">
        {tareas.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
            <input type="checkbox" checked={t.hecha} onChange={() => alternar(t)} aria-label={`Completar ${t.titulo}`} className="h-4 w-4" />
            <div className={`flex-1 ${t.hecha ? 'text-slate-400 line-through' : ''}`}>
              {t.titulo}
              <span className="block text-xs text-slate-500 no-underline">{verFecha(t.vence)} · {t.asignadoNombre || 'Sin asignar'}</span>
            </div>
            <Situacion valor={t.situacion} />
            <button className="text-xs text-red-600 hover:underline" onClick={() => borrar(t)}>Borrar</button>
          </li>
        ))}
        {tareas.length === 0 && <li className="py-4 text-center text-sm text-slate-500">Sin tareas.</li>}
      </ul>
    </section>
  );
}
