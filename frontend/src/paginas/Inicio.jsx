import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { mesActual, pesos } from '../formato';
import { nombrePeriodo } from '../fechas';
import GraficoMeses from '../componentes/GraficoMeses';
import Alerta from '../componentes/Alerta';
import Dato from '../componentes/Dato';

export default function Inicio() {
  const { usuario } = useAuth();
  const [recalculando, setRecalculando] = useState(false);
  const [periodo, setPeriodo] = useState(mesActual());
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  const cargar = () => {
    setError('');
    return api(`/dashboard?periodo=${periodo}`).then(setD).catch((e) => setError(e.message));
  };
  useEffect(() => { cargar(); }, [periodo]);

  async function recalcular() {
    if (!confirm('Se volverán a calcular los totales mensuales a partir de todos los honorarios y cobros. ¿Continuar?')) return;
    setRecalculando(true);
    try { await api('/dashboard/recalcular', { metodo: 'POST' }); await cargar(); } catch (ex) { setError(ex.message); } finally { setRecalculando(false); }
  }
  const valor = (n) => (n === null || n === undefined ? '—' : pesos(n));

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="titulo-pagina">Inicio</h1>
        <label className="flex items-center gap-3 text-[14px]">
          <span className="tecnica text-[12px] text-machine">Período</span>
          <input type="month" className="campo w-44" value={periodo} onChange={(e) => e.target.value && setPeriodo(e.target.value)} />
        </label>
      </div>
      {error && <Alerta tipo="error">{error}</Alerta>}
      {!d ? !error && <p className="text-machine">Cargando…</p> : (
        <>
          {d.avisos?.length > 0 && (
            <div role="alert" className="rounded-panel border border-figure p-4 text-sm">
              <p className="mb-1 font-medium">Parte del Inicio no se pudo cargar:</p>
              <ul className="ml-5 list-disc">{d.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
              <button className="enlace mt-2" onClick={cargar}>Reintentar</button>
            </div>
          )}

          {/* Una sola cifra protagonista: lo cobrado en el período (solo para quien tiene acceso a los montos) */}
          {d.dinero && (
            <section>
              <p className="tecnica text-[12px] text-machine">Cobrado en {nombrePeriodo(d.periodo)}</p>
              <p className="mt-3 break-words font-tecnica text-[44px] font-normal leading-none tracking-[-0.03em] text-figure sm:text-[72px] lg:text-[96px]">{valor(d.honorarios.cobrado)}</p>
              <p className="mt-4 text-[17px] leading-[1.6] text-machine">de {valor(d.honorarios.facturado)} facturados en el mes</p>
            </section>
          )}

          <div className={`grid grid-cols-2 gap-x-8 ${d.dinero ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
            {d.dinero && <Dato titulo="Deuda total de clientes" valor={valor(d.honorarios.deudaTotal)} destacado={d.honorarios.deudaTotal > 0} detalle={d.honorarios.deudoresCantidad === null ? undefined : `${d.honorarios.deudoresCantidad} clientes`} a="/honorarios" />}
            <Dato titulo="Clientes activos" valor={d.clientes?.activos ?? '—'} destacado detalle={d.clientes && `${d.clientes.total} en total · ${d.clientes.potenciales} potenciales`} a="/clientes" />
            <Dato titulo={`Nuevos en ${nombrePeriodo(d.periodo)}`} valor={d.clientes?.nuevosMes ?? '—'} a="/clientes" />
            <Dato titulo="Pendientes urgentes" valor={d.agenda?.urgentes ?? '—'} destacado={d.agenda?.urgentes > 0} detalle="vencidos o para hoy" a="/agenda" />
          </div>

          {d.dinero && d.serie && <GraficoMeses serie={d.serie} seleccionado={d.periodo} />}

          {d.dinero && d.honorarios.deudaTotal !== null && (
            <section>
              <div className="mb-4 flex items-baseline justify-between gap-4">
                <h2 className="titulo-seccion">Mayores deudores</h2>
                <Link to="/honorarios" className="enlace text-[14px]">Ver todos</Link>
              </div>
              <ul className="divide-y border-y">
                {d.honorarios.topDeudores.map((x) => (
                  <li key={x.clienteId} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
                    <Link className="enlace min-w-0 flex-1" to={`/clientes/${x.clienteId}`}>{x.clienteNombre}</Link>
                    <span className="text-[14px] text-machine">{x.cantidad} {x.cantidad === 1 ? 'período' : 'períodos'}</span>
                    <span className="font-tecnica tabular-nums">{pesos(x.saldo)}</span>
                  </li>
                ))}
                {d.honorarios.topDeudores.length === 0 && <li className="py-6 text-[14px] text-machine">Nadie debe nada.</li>}
              </ul>
            </section>
          )}
          {d.dinero && usuario.rol === 'ADMIN' && (
            <p className="text-[13px] text-machine">
              ¿Los totales no coinciden? <button className="enlace disabled:opacity-50" onClick={recalcular} disabled={recalculando}>{recalculando ? 'Recalculando…' : 'Recalcular totales'}</button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
