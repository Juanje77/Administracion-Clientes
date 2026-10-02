import { useEffect, useState } from 'react';
import { api } from '../api';
import { FilaTarea, FormularioTarea, avisarAlertas, textoAviso, useEquipo } from './Tareas';

export { avisarAlertas }; // lo usan otras pantallas

export default function TareasCliente({ clienteId, clienteNombre }) {
  const equipo = useEquipo();
  const [tareas, setTareas] = useState([]);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const cargar = () => api(`/tareas?clienteId=${clienteId}`).then(setTareas).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, [clienteId]);

  const guardado = (r) => { setCreando(false); setEditando(null); setMsg(textoAviso(r)); cargar(); };
  const alternar = async (t) => { await api(`/tareas/${t.id}`, { metodo: 'PATCH', cuerpo: { hecha: !t.hecha } }); avisarAlertas(); cargar(); };
  const borrar = async (t) => {
    if (!confirm('¿Borrar esta tarea?')) return;
    try { await api(`/tareas/${t.id}`, { metodo: 'DELETE' }); avisarAlertas(); cargar(); } catch (ex) { setError(ex.message); }
  };

  return (
    <section className="rounded-lg border bg-white p-4 sm:p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Tareas y recordatorios</h2>
        {!creando && <button className="btn-primario" onClick={() => { setCreando(true); setEditando(null); setMsg(''); }}>+ Nueva tarea</button>}
      </div>
      {creando && <div className="mb-4"><FormularioTarea clienteFijo={{ id: clienteId, nombre: clienteNombre }} equipo={equipo} alGuardar={guardado} alCancelar={() => setCreando(false)} /></div>}
      {msg && <p role="status" className="mb-2 text-sm text-green-700">{msg}</p>}
      {error && <p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}
      <ul className="divide-y">
        {tareas.map((t) => (
          <li key={t.id} className="space-y-2 py-2">
            <FilaTarea tarea={t} mostrarCliente={false} alCompletar={alternar} alEditar={() => { setEditando(editando === t.id ? null : t.id); setCreando(false); setMsg(''); }}
              extra={<button className="text-xs text-red-600 hover:underline" onClick={() => borrar(t)}>Borrar</button>} />
            {editando === t.id && <FormularioTarea tarea={t} clienteFijo={{ id: clienteId, nombre: clienteNombre }} equipo={equipo} alGuardar={guardado} alCancelar={() => setEditando(null)} />}
          </li>
        ))}
        {tareas.length === 0 && <li className="py-4 text-center text-sm text-slate-500">Sin tareas.</li>}
      </ul>
    </section>
  );
}
