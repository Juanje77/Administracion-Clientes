import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { mesActual, pesos } from '../formato';
import { nombrePeriodo } from '../fechas';
import GraficoMeses from '../componentes/GraficoMeses';

function Tile({ titulo, valor, detalle, color = 'text-slate-800', a }) {
  const cuerpo = (
    <div className="h-full rounded-lg border bg-white p-4 hover:border-slate-300">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className={`mt-1 whitespace-nowrap text-lg font-semibold sm:text-2xl ${color}`}>{valor}</p>
      {detalle && <p className="mt-0.5 text-xs text-slate-500">{detalle}</p>}
    </div>
  );
  return a ? <Link to={a}>{cuerpo}</Link> : cuerpo;
}

export default function Inicio() {
  const [periodo, setPeriodo] = useState(mesActual());
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api(`/dashboard?periodo=${periodo}`).then(setD).catch((e) => setError(e.message));
  }, [periodo]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Inicio</h1>
        <label className="flex items-center gap-2 text-sm">
          Período
          <input type="month" className="campo w-44" value={periodo} onChange={(e) => e.target.value && setPeriodo(e.target.value)} />
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {!d ? !error && <p className="text-slate-500">Cargando…</p> : (
        <>
          {/* Una sola cifra protagonista: lo cobrado en el período */}
          <section className="rounded-lg border bg-white p-5 sm:p-6">
            <p className="text-sm text-slate-500">Cobrado en {nombrePeriodo(d.periodo)}</p>
            <p className="mt-1 break-words text-3xl font-semibold text-slate-900 sm:text-5xl">{pesos(d.honorarios.cobrado)}</p>
            <p className="mt-2 text-sm text-slate-600">de {pesos(d.honorarios.facturado)} facturados en el mes</p>
          </section>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile titulo="Deuda total de clientes" valor={pesos(d.honorarios.deudaTotal)} color={d.honorarios.deudaTotal > 0 ? 'text-red-600' : 'text-slate-400'} detalle={`${d.honorarios.deudoresCantidad} clientes`} a="/honorarios" />
            <Tile titulo="Clientes activos" valor={d.clientes.activos} detalle={`${d.clientes.total} en total · ${d.clientes.potenciales} potenciales`} a="/clientes" />
            <Tile titulo={`Nuevos en ${nombrePeriodo(d.periodo)}`} valor={d.clientes.nuevosMes} a="/clientes" />
            <Tile titulo="Pendientes urgentes" valor={d.agenda.urgentes} color={d.agenda.urgentes > 0 ? 'text-red-600' : 'text-slate-400'} detalle="vencidos o para hoy" a="/agenda" />
          </div>

          <GraficoMeses serie={d.serie} seleccionado={d.periodo} />

          <section className="rounded-lg border bg-white p-4 sm:p-6">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-semibold">Mayores deudores</h2>
              <Link to="/honorarios" className="text-sm text-blue-700 hover:underline">Ver todos</Link>
            </div>
            <ul className="divide-y">
              {d.honorarios.topDeudores.map((x) => (
                <li key={x.clienteId} className="flex items-center gap-3 py-2 text-sm">
                  <Link className="flex-1 font-medium text-blue-700 hover:underline" to={`/clientes/${x.clienteId}`}>{x.clienteNombre}</Link>
                  <span className="text-xs text-slate-500">{x.cantidad} {x.cantidad === 1 ? 'período' : 'períodos'}</span>
                  <span className="tabular-nums font-semibold text-red-600">{pesos(x.saldo)}</span>
                </li>
              ))}
              {d.honorarios.topDeudores.length === 0 && <li className="py-4 text-center text-sm text-slate-500">Nadie debe nada. 🎉</li>}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
