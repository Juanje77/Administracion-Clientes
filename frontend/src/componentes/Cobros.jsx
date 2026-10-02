import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { hoyISO, pesos } from '../formato';
import { verFecha } from '../fechas';
import Alerta from './Alerta';

const MEDIOS = { TRANSFERENCIA: 'Transferencia', EFECTIVO: 'Efectivo', CHEQUE: 'Cheque', TARJETA: 'Tarjeta', OTRO: 'Otro' };
const ESTILO = { PENDIENTE: 'insignia-linea', PARCIAL: 'insignia-linea', PAGADO: 'insignia-gris' };
const NOMBRE = { PENDIENTE: 'Pendiente', PARCIAL: 'Parcial', PAGADO: 'Pagado' };

export function EstadoCobro({ honorario }) {
  return (
    <span className="whitespace-nowrap">
      <span className={ESTILO[honorario.estado]}>{NOMBRE[honorario.estado]}</span>
      {honorario.vencido && <span className="insignia-negra ml-1">Vencido</span>}
    </span>
  );
}

// Formulario para registrar un cobro (parcial o total) de un honorario.
export function CobroForm({ honorario, alGuardar, alCancelar }) {
  const [f, setF] = useState({ monto: String(honorario.saldo), fecha: hoyISO(), medio: 'TRANSFERENCIA', nota: '' });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e) {
    e.preventDefault();
    setError(''); setGuardando(true);
    try {
      await api(`/honorarios/${honorario.id}/pagos`, { metodo: 'POST', cuerpo: { ...f, monto: Number(f.monto) } });
      alGuardar();
    } catch (ex) {
      setError(Object.values(ex.detalles || {}).flat()[0] || ex.message);
      setGuardando(false);
    }
  }
  return (
    <form onSubmit={guardar} className="space-y-3 rounded-panel border p-4">
      <p className="text-sm font-medium">Registrar cobro · saldo {pesos(honorario.saldo)}</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <input className="campo" type="number" step="0.01" min="0.01" required value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} aria-label="Monto cobrado" />
        <input className="campo" type="date" required value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} aria-label="Fecha del cobro" />
        <select className="campo" value={f.medio} onChange={(e) => setF({ ...f, medio: e.target.value })} aria-label="Medio de pago">
          {Object.entries(MEDIOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input className="campo" placeholder="Nota (opcional)" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} aria-label="Nota" />
      </div>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <div className="flex gap-2">
        <button className="btn-primario" disabled={guardando}>Guardar cobro</button>
        <button type="button" className="btn-sec" onClick={alCancelar}>Cancelar</button>
        <button type="button" className="text-xs enlace" onClick={() => setF({ ...f, monto: String(honorario.saldo) })}>Cobrar el saldo completo</button>
      </div>
    </form>
  );
}

// Historial de cobros de un honorario (el administrador puede anular uno cargado por error).
export function ListaCobros({ honorario, alCambiar }) {
  const { usuario } = useAuth();
  const [pagos, setPagos] = useState(null);
  const cargar = () => api(`/honorarios/${honorario.id}/pagos`).then(setPagos).catch(() => setPagos([]));
  useEffect(() => { cargar(); }, [honorario.id, honorario.pagado]);

  async function anular(p) {
    if (!confirm(`¿Anular el cobro de ${pesos(p.monto)}? El saldo volverá a quedar pendiente.`)) return;
    await api(`/honorarios/${honorario.id}/pagos/${p.id}`, { metodo: 'DELETE' });
    alCambiar();
  }
  if (!pagos) return <p className="py-2 text-xs text-machine">Cargando…</p>;
  if (pagos.length === 0) return <p className="py-2 text-xs text-machine">Sin cobros registrados.</p>;
  return (
    <ul className="divide-y rounded-panel border bg-white text-sm">
      {pagos.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5">
          <span className="w-24 text-machine">{verFecha(p.fecha)}</span>
          <span className="font-medium">{pesos(p.monto)}</span>
          <span className="text-xs text-machine">{MEDIOS[p.medio]}{p.nota ? ` · ${p.nota}` : ''}</span>
          {usuario.rol === 'ADMIN' && <button className="ml-auto text-xs enlace-tenue" onClick={() => anular(p)}>Anular</button>}
        </li>
      ))}
    </ul>
  );
}
