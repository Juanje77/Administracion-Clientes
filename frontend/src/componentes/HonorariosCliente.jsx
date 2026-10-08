import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { mesActual, pesos } from '../formato';
import { CobroForm, EstadoCobro, ListaCobros, textoRecibo } from './Cobros';
import Alerta from './Alerta';

export default function HonorariosCliente({ clienteId, abonoMensual }) {
  const { usuario } = useAuth();
  const [datos, setDatos] = useState({ datos: [], totales: { saldo: 0, pagado: 0, monto: 0 } });
  const [abierto, setAbierto] = useState(null); // { id, modo: 'cobrar' | 'ver' }
  const [f, setF] = useState({ concepto: abonoMensual ? 'Honorarios mensuales' : '', periodo: mesActual(), monto: abonoMensual || '' });
  const [error, setError] = useState('');

  const cargar = () => api(`/honorarios?clienteId=${clienteId}`).then(setDatos).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, [clienteId]);

  async function agregar(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/honorarios', { metodo: 'POST', cuerpo: { ...f, monto: Number(f.monto), clienteId } });
      setF({ ...f, concepto: '', monto: '' });
      cargar();
    } catch (ex) {
      setError(Object.values(ex.detalles || {}).flat()[0] || ex.message);
    }
  }
  async function borrar(h) {
    if (!confirm('¿Borrar este honorario y sus cobros? No se puede deshacer.')) return;
    await api(`/honorarios/${h.id}`, { metodo: 'DELETE' });
    cargar();
  }
  const terminado = (r) => { setAbierto(r && r.pago ? { id: r.honorario.id, modo: 'ver', aviso: textoRecibo(r.recibo) } : null); cargar(); };

  return (
    <section className="panel">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="titulo-seccion">Honorarios y cobros</h2>
        <p className="text-sm">
          Saldo pendiente: <strong className={datos.totales.saldo > 0 ? 'text-figure' : 'text-figure'}>{pesos(datos.totales.saldo)}</strong>
          {abonoMensual > 0 && <span className="ml-3 text-machine">Abono mensual: {pesos(abonoMensual)}</span>}
        </p>
      </div>

      <form onSubmit={agregar} className="mb-4 grid gap-2 sm:grid-cols-[1fr_9rem_9rem_auto]">
        <input className="campo" required placeholder="Concepto (ej. Balance anual)" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} aria-label="Concepto" />
        <input className="campo" required type="month" value={f.periodo} onChange={(e) => setF({ ...f, periodo: e.target.value })} aria-label="Período" />
        <input className="campo" required type="number" step="0.01" min="0.01" placeholder="Monto" value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} aria-label="Monto" />
        <button className="btn-primario">Agregar</button>
      </form>
      {error && <Alerta tipo="error">{error}</Alerta>}

      <ul className="divide-y">
        {datos.datos.map((h) => (
          <li key={h.id} className="space-y-2 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <div className="min-w-0 flex-1">
                <p>{h.concepto} <span className="text-machine">· {h.periodo}</span></p>
                <p className="text-xs text-machine">Facturado {pesos(h.monto)} · cobrado {pesos(h.pagado)} · saldo {pesos(h.saldo)}</p>
              </div>
              <EstadoCobro honorario={h} />
              {h.saldo > 0 && <button className="btn-primario btn-sm" onClick={() => setAbierto(abierto?.id === h.id && abierto.modo === 'cobrar' ? null : { id: h.id, modo: 'cobrar' })}>Cobrar</button>}
              {h.pagado > 0 && <button className="btn-sec btn-sm" onClick={() => setAbierto(abierto?.id === h.id && abierto.modo === 'ver' ? null : { id: h.id, modo: 'ver' })}>Cobros</button>}
              {usuario.rol === 'ADMIN' && <button className="text-xs enlace-tenue" onClick={() => borrar(h)}>Borrar</button>}
            </div>
            {abierto?.id === h.id && abierto.modo === 'cobrar' && <CobroForm honorario={h} alGuardar={terminado} alCancelar={() => setAbierto(null)} />}
            {abierto?.id === h.id && abierto.modo === 'ver' && <ListaCobros honorario={h} alCambiar={terminado} aviso={abierto.aviso} />}
          </li>
        ))}
        {datos.datos.length === 0 && <li className="py-4 text-center text-sm text-machine">Sin honorarios cargados.</li>}
      </ul>
    </section>
  );
}
