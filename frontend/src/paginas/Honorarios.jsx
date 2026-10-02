import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { mesActual, pesos } from '../formato';
import { CobroForm, EstadoCobro, ListaCobros } from '../componentes/Cobros';

function Tarjeta({ titulo, valor, color }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-xs text-slate-500">{titulo}</p>
      <p className={`text-xl font-semibold ${color}`}>{valor}</p>
    </div>
  );
}

function PorMes() {
  const [periodo, setPeriodo] = useState(mesActual());
  const [estado, setEstado] = useState('');
  const [q, setQ] = useState('');
  const [r, setR] = useState({ datos: [], totales: { monto: 0, pagado: 0, saldo: 0 } });
  const [abierto, setAbierto] = useState(null);
  const [msg, setMsg] = useState(null);

  const cargar = () => {
    const p = new URLSearchParams({ periodo });
    if (estado) p.set('estado', estado);
    if (q) p.set('q', q);
    api(`/honorarios?${p}`).then(setR).catch((e) => setMsg({ ok: false, texto: e.message }));
  };
  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [periodo, estado, q]);

  async function generar() {
    setMsg(null);
    try {
      const g = await api('/honorarios/generar', { metodo: 'POST', cuerpo: { periodo } });
      setMsg({ ok: true, texto: `Abonos generados: ${g.creados}. Ya existían: ${g.yaExistian}.${g.sinAbono ? ` Clientes activos sin abono mensual cargado: ${g.sinAbono}.` : ''}` });
      cargar();
    } catch (ex) {
      setMsg({ ok: false, texto: ex.message });
    }
  }
  const terminado = () => { setAbierto(null); cargar(); };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Tarjeta titulo="Facturado" valor={pesos(r.totales.monto)} color="text-slate-800" />
        <Tarjeta titulo="Cobrado" valor={pesos(r.totales.pagado)} color="text-green-700" />
        <Tarjeta titulo="Pendiente" valor={pesos(r.totales.saldo)} color={r.totales.saldo > 0 ? 'text-red-600' : 'text-slate-400'} />
      </div>
      <div className="grid gap-2 sm:grid-cols-[10rem_10rem_1fr_auto]">
        <input type="month" className="campo" value={periodo} onChange={(e) => e.target.value && setPeriodo(e.target.value)} aria-label="Mes" />
        <select className="campo" value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado de cobro">
          <option value="">Todos</option>
          <option value="PENDIENTE">Pendientes</option>
          <option value="PARCIAL">Cobro parcial</option>
          <option value="PAGADO">Pagados</option>
        </select>
        <input className="campo" placeholder="Buscar cliente" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" />
        <button className="btn-sec" onClick={generar}>Generar abonos del mes</button>
      </div>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.texto}</p>}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Concepto</th><th className="px-3 py-2 text-right">Facturado</th><th className="px-3 py-2 text-right">Cobrado</th><th className="px-3 py-2 text-right">Saldo</th><th className="px-3 py-2">Estado</th><th /></tr>
          </thead>
          <tbody className="divide-y">
            {r.datos.map((h) => (
              <Fragment key={h.id}>
                <tr className="align-top">
                  <td className="px-3 py-2 font-medium"><Link className="text-blue-700 hover:underline" to={`/clientes/${h.clienteId}`}>{h.clienteNombre}</Link></td>
                  <td className="px-3 py-2">{h.concepto}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{pesos(h.monto)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{pesos(h.pagado)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium">{pesos(h.saldo)}</td>
                  <td className="px-3 py-2"><EstadoCobro honorario={h} /></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {h.saldo > 0 && <button className="btn-primario" onClick={() => setAbierto(abierto?.id === h.id && abierto.modo === 'cobrar' ? null : { id: h.id, modo: 'cobrar' })}>Cobrar</button>}{' '}
                    {h.pagado > 0 && <button className="btn-sec" onClick={() => setAbierto(abierto?.id === h.id && abierto.modo === 'ver' ? null : { id: h.id, modo: 'ver' })}>Cobros</button>}
                  </td>
                </tr>
                {abierto?.id === h.id && (
                  <tr><td colSpan={7} className="bg-slate-50 px-3 py-3">
                    {abierto.modo === 'cobrar' ? <CobroForm honorario={h} alGuardar={terminado} alCancelar={() => setAbierto(null)} /> : <ListaCobros honorario={h} alCambiar={terminado} />}
                  </td></tr>
                )}
              </Fragment>
            ))}
            {r.datos.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No hay honorarios en este mes. Usa “Generar abonos del mes” para crearlos desde el abono de cada cliente.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Deudores() {
  const [r, setR] = useState(null);
  useEffect(() => { api('/honorarios/deudores').then(setR); }, []);
  if (!r) return <p className="text-slate-500">Cargando…</p>;
  return (
    <div className="space-y-4">
      <Tarjeta titulo="Total adeudado por clientes" valor={pesos(r.total)} color={r.total > 0 ? 'text-red-600' : 'text-slate-400'} />
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Períodos adeudados</th><th className="px-3 py-2">Desde</th><th className="px-3 py-2 text-right">Saldo</th></tr>
          </thead>
          <tbody className="divide-y">
            {r.datos.map((d) => (
              <tr key={d.clienteId}>
                <td className="px-3 py-2 font-medium"><Link className="text-blue-700 hover:underline" to={`/clientes/${d.clienteId}`}>{d.clienteNombre}</Link></td>
                <td className="px-3 py-2">{d.cantidad}</td>
                <td className="px-3 py-2">{d.masAntiguo}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-red-600">{pesos(d.saldo)}</td>
              </tr>
            ))}
            {r.datos.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-500">Nadie debe nada. 🎉</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Honorarios() {
  const [vista, setVista] = useState('mes');
  const tab = (id, texto) => (
    <button onClick={() => setVista(id)} className={`rounded-md px-3 py-1.5 text-sm ${vista === id ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}>{texto}</button>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Honorarios</h1>
        <div className="flex gap-1">{tab('mes', 'Por mes')}{tab('deudores', 'Deudores')}</div>
      </div>
      {vista === 'mes' ? <PorMes /> : <Deudores />}
    </div>
  );
}
