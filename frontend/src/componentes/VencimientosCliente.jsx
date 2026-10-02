import { useEffect, useState } from 'react';
import { api } from '../api';
import { verFecha } from '../fechas';
import Situacion from './Situacion';
import { avisarAlertas } from './TareasCliente';

const mesActual = () => new Date().toLocaleDateString('en-CA').slice(0, 7);

export default function VencimientosCliente({ clienteId }) {
  const [lista, setLista] = useState([]);
  const [f, setF] = useState({ impuesto: '', periodo: mesActual(), vence: '' });
  const [error, setError] = useState('');

  const cargar = () => api(`/vencimientos?clienteId=${clienteId}`).then(setLista).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, [clienteId]);

  async function agregar(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/vencimientos', { metodo: 'POST', cuerpo: { ...f, clienteId } });
      setF({ ...f, impuesto: '', vence: '' });
      cargar(); avisarAlertas();
    } catch (ex) {
      setError(Object.values(ex.detalles || {}).flat()[0] || ex.message);
    }
  }
  const alternar = async (v) => {
    await api(`/vencimientos/${v.id}`, { metodo: 'PATCH', cuerpo: { estado: v.estado === 'PRESENTADO' ? 'PENDIENTE' : 'PRESENTADO' } });
    cargar(); avisarAlertas();
  };
  const borrar = async (v) => {
    if (!confirm('¿Borrar este vencimiento?')) return;
    await api(`/vencimientos/${v.id}`, { metodo: 'DELETE' }); cargar(); avisarAlertas();
  };

  return (
    <section className="rounded-lg border bg-white p-4 sm:p-6">
      <h2 className="mb-3 font-semibold">Vencimientos impositivos</h2>
      <form onSubmit={agregar} className="mb-4 grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto]">
        <input className="campo" required placeholder="Impuesto (IVA, Ganancias, IIBB…)" value={f.impuesto} onChange={(e) => setF({ ...f, impuesto: e.target.value })} aria-label="Impuesto" />
        <input className="campo" required type="month" value={f.periodo} onChange={(e) => setF({ ...f, periodo: e.target.value })} aria-label="Período" />
        <input className="campo" required type="date" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} aria-label="Fecha de vencimiento" />
        <button className="btn-primario">Agregar</button>
      </form>
      {error && <p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}
      <ul className="divide-y">
        {lista.map((v) => (
          <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
            <div className="flex-1">
              {v.impuesto} <span className="text-slate-500">· período {v.periodo}</span>
              <span className="block text-xs text-slate-500">Vence {verFecha(v.vence)}</span>
            </div>
            <Situacion valor={v.situacion} />
            <button className="btn-sec" onClick={() => alternar(v)}>{v.estado === 'PRESENTADO' ? 'Reabrir' : 'Presentado'}</button>
            <button className="text-xs text-red-600 hover:underline" onClick={() => borrar(v)}>Borrar</button>
          </li>
        ))}
        {lista.length === 0 && <li className="py-4 text-center text-sm text-slate-500">Sin vencimientos cargados.</li>}
      </ul>
    </section>
  );
}
