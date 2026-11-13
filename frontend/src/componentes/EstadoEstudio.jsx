import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { pesos } from '../formato';
import { nombrePeriodo } from '../fechas';
import Dato from './Dato';
import Alerta from './Alerta';

const FALTAN = {
  sinEmail: ['Clientes activos sin email', 'no se les pueden mandar recibos ni recordatorios'],
  sinCuit: ['Clientes activos sin CUIT', 'no se les generan vencimientos'],
  sinObligaciones: ['Activos sin obligaciones marcadas', 'no tienen vencimientos en la Agenda'],
  sinAbono: ['Activos sin abono mensual', 'no se les generan los honorarios del mes'],
  sociedadesSinCierre: ['Sociedades sin mes de cierre de balance', 'no se les generan Ganancias Sociedades ni anticipos'],
};

// Tablero del estado actual del estudio (solo administradores).
export default function EstadoEstudio({ periodo }) {
  const [e, setE] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setE(null); api(`/dashboard/estudio?periodo=${periodo}`).then(setE).catch((x) => setError(x.message)); }, [periodo]);

  if (error) return <Alerta tipo="error">{error}</Alerta>;
  if (!e) return <p className="text-machine">Cargando el estado del estudio…</p>;
  const r = e.resultado;
  const maxDeuda = Math.max(...e.deuda.tramos.map((t) => t.saldo), 1);
  const faltan = Object.entries(FALTAN).filter(([k]) => e.faltan[k].cantidad > 0);

  return (
    <div className="space-y-10">
      <section className="space-y-4">
        <h2 className="titulo-seccion">Resultado de {nombrePeriodo(e.periodo)}</h2>
        <div className="grid grid-cols-2 gap-x-8 lg:grid-cols-4">
          <Dato titulo="Facturado" valor={pesos(r.facturado)} destacado a="/honorarios" />
          <Dato titulo="Cobrado" valor={pesos(r.cobrado)} detalle={r.cobranza === null ? 'sin honorarios' : `${r.cobranza}% de lo facturado · falta ${pesos(r.falta)}`} destacado a="/honorarios" />
          <Dato titulo="Sueldos que corresponden" valor={pesos(r.sueldos)} detalle={`pagado ${pesos(r.sueldosPagados)}`} a="/sueldos" />
          <Dato titulo="Ganancia del estudio" valor={pesos(r.ganancia)} detalle="cobrado − sueldos (antes de gastos)" destacado a="/sueldos" />
        </div>
        {r.cobranza !== null && (
          <div>
            <div className="h-2 w-full bg-linea" role="img" aria-label={`Cobranza ${r.cobranza}%`}><div className="h-2 bg-figure" style={{ width: `${Math.min(100, r.cobranza)}%` }} /></div>
            <p className="mt-1 text-[13px] text-machine">Cobranza del mes: {r.cobranza}%</p>
          </div>
        )}
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-4"><h2 className="titulo-seccion">Deuda por antigüedad</h2><span className="font-tecnica tabular-nums">{pesos(e.deuda.total)}</span></div>
          <ul className="space-y-3">
            {e.deuda.tramos.map((t, i) => (
              <li key={t.clave}>
                <div className="flex justify-between gap-3 text-[14px]">
                  <span className={i >= 2 && t.saldo > 0 ? 'text-venc' : ''}>{t.nombre} <span className="text-machine">· {t.cantidad} {t.cantidad === 1 ? 'honorario' : 'honorarios'}</span></span>
                  <span className="font-tecnica tabular-nums">{pesos(t.saldo)}</span>
                </div>
                <div className="mt-1 h-2 w-full bg-linea"><div className={`h-2 ${i >= 2 ? 'bg-venc' : 'bg-figure'}`} style={{ width: `${(t.saldo / maxDeuda) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
          <Link to="/honorarios" className="enlace text-[14px]">Ver deudores</Link>
        </section>

        <section className="space-y-3">
          <h2 className="titulo-seccion">Trabajo pendiente</h2>
          <div className="grid grid-cols-3 gap-x-6">
            <Dato titulo="Vencimientos vencidos" valor={e.vencimientos.vencidos} destacado={e.vencimientos.vencidos > 0} a="/agenda" />
            <Dato titulo="Vencen hoy" valor={e.vencimientos.hoy} destacado={e.vencimientos.hoy > 0} a="/agenda" />
            <Dato titulo="Próximos 7 días" valor={e.vencimientos.proximos} a="/agenda" />
          </div>
          <p className="text-[14px] text-machine">
            {e.tareasPendientes} {e.tareasPendientes === 1 ? 'tarea pendiente' : 'tareas pendientes'} en el estudio
            {e.tareasSinResponsable > 0 && <> · <strong className="text-figure">{e.tareasSinResponsable} sin responsable</strong></>}.
            Cartera: {e.cartera.activos} activos, {e.cartera.potenciales} potenciales, {e.cartera.inactivos} inactivos
            {e.cartera.nuevosMes > 0 && <> · {e.cartera.nuevosMes} nuevos este mes</>}.
          </p>
        </section>
      </div>

      <section className="space-y-3">
        <h2 className="titulo-seccion">Equipo</h2>
        <div className="overflow-x-auto panel-plano">
          <table className="w-full text-left text-sm">
            <thead className="encabezado-tabla">
              <tr><th className="px-3 py-2">Persona</th><th className="px-3 py-2 text-right">Clientes activos</th><th className="px-3 py-2 text-right">Tareas pendientes</th><th className="px-3 py-2 text-right">Vencidas</th><th className="px-3 py-2 text-right">Cobrado de sus clientes</th><th className="px-3 py-2 text-right">Sueldo del mes</th></tr>
            </thead>
            <tbody className="divide-y">
              {e.equipo.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium">{p.admin ? `${p.nombre} (titular)` : p.nombre}</td>
                  <td className="px-3 py-2 text-right">{p.clientes}{p.admin && p.clientes > 0 && <span className="text-xs text-machine"> sin asignar</span>}</td>
                  <td className="px-3 py-2 text-right">{p.pendientes}</td>
                  <td className={`px-3 py-2 text-right ${p.vencidas > 0 ? 'font-medium text-venc' : 'text-machine'}`}>{p.vencidas}</td>
                  <td className="px-3 py-2 text-right">{p.cobrado === null ? <span className="text-machine">—</span> : pesos(p.cobrado)}</td>
                  <td className="px-3 py-2 text-right">{p.sueldo === null ? <span className="text-machine">—</span> : pesos(p.sueldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link to="/sueldos" className="enlace text-[14px]">Ver sueldos y pagos</Link>
      </section>

      <section className="space-y-3">
        <h2 className="titulo-seccion">Para completar</h2>
        {faltan.length === 0 ? <p className="text-[14px] text-machine">No hay datos pendientes de completar. 👌</p> : (
          <ul className="divide-y border-y">
            {faltan.map(([k, [titulo, motivo]]) => (
              <li key={k} className="py-3 text-sm">
                <p><strong>{e.faltan[k].cantidad}</strong> · {titulo} <span className="text-machine">— {motivo}</span></p>
                <p className="mt-1 text-xs">
                  {e.faltan[k].ejemplos.map((c, i) => <span key={c.id}>{i > 0 && ' · '}<Link className="enlace" to={`/clientes/${c.id}/editar`}>{c.nombre}</Link></span>)}
                  {e.faltan[k].cantidad > e.faltan[k].ejemplos.length && <span className="text-machine"> … y {e.faltan[k].cantidad - e.faltan[k].ejemplos.length} más</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
