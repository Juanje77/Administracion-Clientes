import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { nombrePeriodo, verFecha } from '../fechas';
import { avisarAlertas } from '../componentes/TareasCliente';
import Alerta from '../componentes/Alerta';

const DIGITOS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

// Agrupa las terminaciones que vencen el mismo día: [{ fecha, digitos: '0-3' }, ...]
function grupos(fechas) {
  const porFecha = {};
  for (const d of DIGITOS) (porFecha[fechas[d] || ''] ||= []).push(Number(d));
  const rango = (ds) => ds.reduce((r, d, i) => {
    if (i && d === ds[i - 1] + 1) r[r.length - 1][1] = d; else r.push([d, d]);
    return r;
  }, []).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
  return Object.entries(porFecha)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, ds]) => ({ fecha, digitos: rango(ds) }));
}

function FilaEditable({ fila, alCambiar, alBorrar }) {
  const [abierta, setAbierta] = useState(false);
  const resumen = grupos(fila.fechas);
  const cambiar = (campo) => (e) => alCambiar({ ...fila, [campo]: e.target.value });
  const cambiarFecha = (d) => (e) => alCambiar({ ...fila, fechas: { ...fila.fechas, [d]: e.target.value || null } });
  return (
    <tr className="align-top odd:bg-white even:">
      <td className="px-3 py-2">
        <p className="font-medium">{fila.obligacion}</p>
        <p className="text-xs text-machine">{fila.concepto}</p>
        {abierta && (
          <div className="mt-2 space-y-2">
            <input className="campo" value={fila.obligacion} onChange={cambiar('obligacion')} aria-label="Obligación" />
            <input className="campo" value={fila.concepto} onChange={cambiar('concepto')} aria-label="Concepto" />
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        {!abierta ? (
          <div className="flex flex-wrap gap-1.5">
            {resumen.map((g) => (
              <span key={g.fecha} className="rounded-full border border-regla px-3 py-0.5 text-xs text-figure">
                {g.digitos} → {g.fecha ? verFecha(g.fecha).slice(0, 5) : 'sin fecha'}
              </span>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {DIGITOS.map((d) => (
              <label key={d} className="text-xs text-machine">
                Termina en {d}
                <input type="date" className="campo mt-0.5" value={fila.fechas[d] || ''} onChange={cambiarFecha(d)} />
              </label>
            ))}
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <button className="btn-sec" onClick={() => setAbierta(!abierta)}>{abierta ? 'Listo' : 'Editar'}</button>{' '}
        <button className="text-xs enlace-tenue" onClick={alBorrar}>Quitar</button>
      </td>
    </tr>
  );
}

function Editor({ inicial, alCerrar, alGuardar }) {
  const [periodo, setPeriodo] = useState(inicial.periodo);
  const [filas, setFilas] = useState(inicial.filas);
  const [msg, setMsg] = useState(null);

  const agregar = () => {
    const n = Date.now().toString(36);
    setFilas([...filas, {
      seccion: '', obligacion: 'Nueva obligación', concepto: '', notas: '', clave: `manual-${n}`, titulo: 'Nueva obligación',
      fechas: Object.fromEntries(DIGITOS.map((d) => [d, null])),
    }]);
  };
  async function guardar() {
    setMsg(null);
    const listas = filas.map((f) => (f.clave.startsWith('manual-') ? { ...f, titulo: [f.obligacion, f.concepto].filter(Boolean).join(' – ') } : f));
    try {
      await api(`/calendarios/${periodo}`, { metodo: 'PUT', cuerpo: { filas: listas } });
      alGuardar(periodo);
    } catch (ex) {
      setMsg(Object.values(ex.detalles || {}).flat()[0] || ex.message);
    }
  }

  let seccionAnterior = null;
  return (
    <section className="space-y-4 panel">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="titulo-seccion">Revisar calendario</h2>
        <label className="flex items-center gap-2 text-sm">
          Mes
          <input type="month" className="campo w-40" value={periodo} onChange={(e) => setPeriodo(e.target.value)} />
        </label>
        <span className="text-sm text-machine">{nombrePeriodo(periodo)} · {filas.length} filas</span>
      </div>

      {inicial.avisos?.length > 0 && (
        <div role="alert" className="rounded-panel border border-figure p-4 text-sm">
          <p className="font-medium">El lector no pudo interpretar algunas partes. Revísalas antes de guardar:</p>
          <ul className="ml-5 list-disc">{inicial.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}
      {inicial.nuevo && (
        <p className="text-sm text-machine">
          Compara estas fechas con el PDF antes de guardar: se usan para generar los vencimientos de tus clientes.
          Cada obligación muestra qué terminaciones de CUIT vencen el mismo día.
        </p>
      )}

      <div className="overflow-x-auto rounded-panel border">
        <table className="w-full text-left text-sm">
          <thead className="encabezado-tabla">
            <tr><th className="px-3 py-2">Obligación / concepto</th><th className="px-3 py-2">Terminación de CUIT → vence</th><th /></tr>
          </thead>
          <tbody>
            {filas.map((f, i) => {
              const titulo = f.seccion !== seccionAnterior ? f.seccion : null;
              seccionAnterior = f.seccion;
              return [
                titulo && <tr key={`s${i}`}><td colSpan={3} className="tecnica bg-figure px-3 py-2 text-[12px] text-white">{titulo}</td></tr>,
                <FilaEditable key={f.clave} fila={f} alCambiar={(nueva) => setFilas(filas.map((x, j) => (j === i ? nueva : x)))} alBorrar={() => setFilas(filas.filter((_, j) => j !== i))} />,
              ];
            })}
          </tbody>
        </table>
      </div>

      {msg && <Alerta tipo="error">{msg}</Alerta>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primario" onClick={guardar}>Guardar calendario</button>
        <button className="btn-sec" onClick={agregar}>+ Agregar fila</button>
        <button className="btn-sec" onClick={alCerrar}>Cancelar</button>
      </div>
    </section>
  );
}

export default function Calendario() {
  const { usuario } = useAuth();
  const [lista, setLista] = useState([]);
  const [edicion, setEdicion] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [msg, setMsg] = useState(null);
  const [resultado, setResultado] = useState(null);

  const cargar = () => api('/calendarios').then(setLista).catch((e) => setMsg({ ok: false, texto: e.message }));
  useEffect(() => { cargar(); }, []);

  async function subir(e) {
    const archivo = e.target.files[0];
    e.target.value = '';
    if (!archivo) return;
    setMsg(null); setResultado(null); setCargando(true);
    try {
      const r = await api('/calendarios/importar', { metodo: 'POST', cuerpo: archivo });
      setEdicion({ ...r, nuevo: true });
    } catch (ex) {
      setMsg({ ok: false, texto: ex.message });
    } finally {
      setCargando(false);
    }
  }
  async function abrir(periodo) {
    setMsg(null); setResultado(null);
    const c = await api(`/calendarios/${periodo}`);
    setEdicion({ periodo: c.id, filas: c.filas, avisos: [], nuevo: false });
  }
  async function aplicar(periodo) {
    setMsg(null); setResultado(null);
    try {
      setResultado({ periodo, ...(await api(`/calendarios/${periodo}/aplicar`, { metodo: 'POST' })) });
      avisarAlertas();
    } catch (ex) {
      setMsg({ ok: false, texto: ex.message });
    }
  }
  async function borrar(periodo) {
    if (!confirm(`¿Borrar el calendario de ${nombrePeriodo(periodo)}? Los vencimientos ya generados se conservan.`)) return;
    await api(`/calendarios/${periodo}`, { metodo: 'DELETE' });
    cargar();
  }
  const guardado = (periodo) => {
    setEdicion(null); cargar();
    setMsg({ ok: true, texto: `Calendario de ${nombrePeriodo(periodo)} guardado. Ya puedes aplicarlo a tus clientes.` });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="titulo-pagina">Calendario impositivo</h1>
        <label className={`btn-primario cursor-pointer ${cargando ? 'opacity-50' : ''}`}>
          {cargando ? 'Leyendo PDF…' : '+ Cargar calendario del mes (PDF)'}
          <input type="file" accept="application/pdf" className="sr-only" onChange={subir} disabled={cargando} />
        </label>
      </div>
      <p className="text-sm text-machine">
        Cada mes carga el PDF del calendario de vencimientos. El sistema lo lee, tú lo revisas y lo guardas;
        después se aplica a tus clientes según las obligaciones que marcaste en cada uno y la terminación de su CUIT.
      </p>

      {msg && <Alerta tipo={msg.ok ? 'ok' : 'error'}>{msg.texto}</Alerta>}

      {resultado && (
        <div role="status" className="space-y-1 rounded-panel border border-figure p-4 text-sm">
          <p className="font-medium">Calendario de {nombrePeriodo(resultado.periodo)} aplicado a {resultado.clientes} clientes activos con obligaciones.</p>
          <p>Vencimientos creados: {resultado.creados} · actualizados: {resultado.actualizados} · sin cambios: {resultado.sinCambios}.</p>
          {resultado.sinCuit.length > 0 && <p className="text-figure">Sin CUIT válido (omitidos): {resultado.sinCuit.join(', ')}.</p>}
          {resultado.sinFecha.length > 0 && <p className="text-figure">Sin fecha en el calendario: {resultado.sinFecha.join('; ')}.</p>}
          {resultado.clientes === 0 && <p>Ningún cliente activo tiene obligaciones marcadas: edita cada cliente y selecciónalas.</p>}
        </div>
      )}

      {edicion && <Editor key={edicion.periodo + edicion.nuevo} inicial={edicion} alCerrar={() => setEdicion(null)} alGuardar={guardado} />}

      <section className="panel">
        <h2 className="titulo-seccion mb-3">Calendarios cargados</h2>
        <ul className="divide-y">
          {lista.map((c) => (
            <li key={c.periodo} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="flex-1 font-medium">{nombrePeriodo(c.periodo)} <span className="font-normal text-machine">· {c.filas} filas</span></span>
              <button className="btn-sec btn-sm" onClick={() => abrir(c.periodo)}>Ver / editar</button>
              <button className="btn-primario btn-sm" onClick={() => aplicar(c.periodo)}>Aplicar a clientes</button>
              {usuario.rol === 'ADMIN' && <button className="text-xs enlace-tenue" onClick={() => borrar(c.periodo)}>Borrar</button>}
            </li>
          ))}
          {lista.length === 0 && <li className="py-4 text-center text-sm text-machine">Todavía no cargaste ningún calendario.</li>}
        </ul>
      </section>
    </div>
  );
}
