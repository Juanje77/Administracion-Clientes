import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { hoyISO, mesActual, pesos } from '../formato';
import { verFecha } from '../fechas';
import Dato from '../componentes/Dato';
import Alerta from '../componentes/Alerta';

// Cambia el % de una persona (se guarda en su usuario).
function Porcentaje({ fila, alCambiar }) {
  const [valor, setValor] = useState(String(fila.porcentaje));
  useEffect(() => { setValor(String(fila.porcentaje)); }, [fila.porcentaje]);
  async function guardar() {
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0 || n > 100 || n === fila.porcentaje) { setValor(String(fila.porcentaje)); return; }
    await api(`/usuarios/${fila.usuarioId}`, { metodo: 'PATCH', cuerpo: { porcentajeSueldo: n } });
    alCambiar();
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input className="campo !w-16 !px-2 !py-1.5 text-right" type="number" min="0" max="100" step="0.5" value={valor} onChange={(e) => setValor(e.target.value)}
        onBlur={guardar} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} aria-label={`Porcentaje de ${fila.nombre}`} />
      %
    </span>
  );
}

function PagoForm({ fila, periodo, alGuardar, alCancelar }) {
  const [f, setF] = useState({ monto: String(Math.max(fila.pendiente, 0)), fecha: hoyISO(), nota: '' });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  async function guardar(e) {
    e.preventDefault();
    setError(''); setGuardando(true);
    try {
      await api('/sueldos/pagos', { metodo: 'POST', cuerpo: { usuarioId: fila.usuarioId, periodo, monto: Number(f.monto), fecha: f.fecha, nota: f.nota } });
      alGuardar();
    } catch (ex) {
      setError(Object.values(ex.detalles || {}).flat()[0] || ex.message);
      setGuardando(false);
    }
  }
  return (
    <form onSubmit={guardar} className="space-y-3 border border-regla bg-white p-4">
      <p className="text-sm font-medium">Pago de sueldo a {fila.nombre} · corresponde {pesos(fila.corresponde)} · pendiente {pesos(fila.pendiente)}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <input className="campo" type="number" step="0.01" min="0.01" required value={f.monto} onChange={(e) => setF({ ...f, monto: e.target.value })} aria-label="Monto pagado" />
        <input className="campo" type="date" required value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} aria-label="Fecha del pago" />
        <input className="campo" placeholder="Nota (ej. adelanto)" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} aria-label="Nota" />
      </div>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primario" disabled={guardando}>Registrar pago</button>
        <button type="button" className="btn-sec" onClick={alCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

export default function Sueldos() {
  const [periodo, setPeriodo] = useState(mesActual());
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState(null); // usuarioId con el formulario de pago abierto

  const cargar = () => api(`/sueldos?periodo=${periodo}`).then((d) => { setR(d); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, [periodo]);

  async function anular(p) {
    if (!confirm(`¿Anular el pago de ${pesos(p.monto)} a ${p.usuarioNombre}?`)) return;
    await api(`/sueldos/pagos/${p.id}`, { metodo: 'DELETE' });
    cargar();
  }

  const t = r?.totales;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="titulo-pagina">Sueldos</h1>
        <input type="month" className="campo !w-44" value={periodo} onChange={(e) => e.target.value && setPeriodo(e.target.value)} aria-label="Mes" />
      </div>
      <p className="text-sm text-machine">
        Cada persona cobra un porcentaje de lo <strong>cobrado en el mes</strong> de los clientes que tiene asignados (si un cliente tiene varias personas, se reparte en partes iguales). Los clientes sin nadie asignado son tuyos y no generan sueldo.
        El porcentaje de cada una se edita acá o en <Link className="enlace" to="/usuarios">Usuarios</Link>; la asignación de clientes, en la ficha del cliente o en Usuarios.
      </p>
      {error && <Alerta tipo="error">{error}</Alerta>}

      {t && (
        <>
          <div className="grid grid-cols-2 gap-x-8 lg:grid-cols-4">
            <Dato titulo="Cobrado del mes" valor={pesos(t.cobrado)} destacado />
            <Dato titulo="Sueldos que corresponden" valor={pesos(t.sueldos)} detalle={`pagado ${pesos(t.pagado)} · pendiente ${pesos(t.pendiente)}`} destacado />
            <Dato titulo="Ganancia del estudio" valor={pesos(t.ganancia)} detalle="cobrado − sueldos que corresponden" destacado />
            <Dato titulo="Ganancia con lo pagado" valor={pesos(t.gananciaReal)} detalle="cobrado − sueldos pagados hasta hoy" />
          </div>

          <div className="overflow-x-auto panel-plano">
            <table className="w-full text-left text-sm">
              <thead className="encabezado-tabla">
                <tr><th className="px-3 py-2">Persona</th><th className="px-3 py-2">%</th><th className="px-3 py-2 text-right">Cobrado de sus clientes</th><th className="px-3 py-2 text-right">Corresponde</th><th className="px-3 py-2 text-right">Pagado</th><th className="px-3 py-2 text-right">Pendiente</th><th /></tr>
              </thead>
              <tbody className="divide-y">
                {r.filas.map((f) => (
                  <Fragment key={f.usuarioId}>
                    <tr>
                      <td className="px-3 py-2 font-medium">{f.nombre}</td>
                      <td className="px-3 py-2"><Porcentaje fila={f} alCambiar={cargar} /></td>
                      <td className="px-3 py-2 text-right">{pesos(f.base)}</td>
                      <td className="px-3 py-2 text-right font-medium">{pesos(f.corresponde)}</td>
                      <td className="px-3 py-2 text-right">{pesos(f.pagado)}</td>
                      <td className={`px-3 py-2 text-right ${f.pendiente > 0 ? 'font-medium text-figure' : 'text-machine'}`}>{pesos(f.pendiente)}</td>
                      <td className="px-3 py-2 text-right"><button className="btn-sec btn-sm" onClick={() => setAbierto(abierto === f.usuarioId ? null : f.usuarioId)}>Pagar</button></td>
                    </tr>
                    {(abierto === f.usuarioId || f.pagos.length > 0) && (
                      <tr><td colSpan={7} className="space-y-2 bg-fondo px-3 py-3">
                        {abierto === f.usuarioId && <PagoForm fila={f} periodo={periodo} alGuardar={() => { setAbierto(null); cargar(); }} alCancelar={() => setAbierto(null)} />}
                        {f.pagos.length > 0 && (
                          <ul className="divide-y border border-regla bg-white text-sm">
                            {f.pagos.map((p) => (
                              <li key={p.id} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5">
                                <span className="w-24 text-machine">{verFecha(p.fecha)}</span>
                                <span className="font-medium">{pesos(p.monto)}</span>
                                {p.nota && <span className="text-xs text-machine">{p.nota}</span>}
                                <button className="ml-auto py-1 text-xs enlace-tenue" onClick={() => anular(p)}>Anular</button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td></tr>
                    )}
                  </Fragment>
                ))}
                <tr className="bg-fondo">
                  <td className="px-3 py-2 font-medium">Tus clientes (sin asignar)</td>
                  <td className="px-3 py-2 text-machine">—</td>
                  <td className="px-3 py-2 text-right">{pesos(t.sinAsignar)}</td>
                  <td className="px-3 py-2 text-right text-machine" colSpan={4}>Los clientes sin nadie asignado se consideran tuyos: lo cobrado queda íntegro para el estudio, sin sueldo.</td>
                </tr>
                {r.filas.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-machine">No hay personas en el equipo. Creá usuarios en <Link className="enlace" to="/usuarios">Usuarios</Link>.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-machine">Si cambiás el porcentaje de una persona, el “corresponde” de meses anteriores se recalcula con el nuevo valor; lo que ya registraste como pagado no cambia.</p>
        </>
      )}
    </div>
  );
}
