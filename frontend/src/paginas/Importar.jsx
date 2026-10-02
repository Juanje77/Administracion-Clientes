import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const ESTILO = {
  OK: 'bg-green-100 text-green-700',
  ADVERTENCIA: 'bg-amber-100 text-amber-800',
  RECHAZADA: 'bg-red-100 text-red-700',
};
const NOMBRE = { OK: 'Listo', ADVERTENCIA: 'Revisar', RECHAZADA: 'Se omite' };
const ESTADO_CLIENTE = { ACTIVO: 'Activo', INACTIVO: 'Inactivo', POTENCIAL: 'Potencial' };
const MAX_VISIBLES = 200;

export default function Importar() {
  const [archivo, setArchivo] = useState(null);
  const [vista, setVista] = useState(null);
  const [filtro, setFiltro] = useState('TODAS');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);

  async function leer(file, mapeo) {
    setError(''); setResultado(null); setCargando(true);
    try {
      const q = mapeo ? `?mapeo=${encodeURIComponent(JSON.stringify(mapeo))}` : '';
      setVista(await api(`/importacion/clientes${q}`, { metodo: 'POST', cuerpo: file }));
    } catch (ex) {
      setVista(null); setError(ex.message);
    } finally {
      setCargando(false);
    }
  }
  function elegir(e) {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setArchivo(f); setFiltro('TODAS');
    leer(f);
  }
  const cambiarColumna = (indice, campo) => leer(archivo, { ...vista.mapeo, [indice]: campo || undefined });

  async function importar() {
    const n = vista.resumen.ok + vista.resumen.advertencias;
    if (!confirm(`Se crearán ${n} clientes. ¿Continuar?`)) return;
    setError(''); setCargando(true);
    try {
      const q = `?confirmar=1&mapeo=${encodeURIComponent(JSON.stringify(vista.mapeo))}`;
      setResultado(await api(`/importacion/clientes${q}`, { metodo: 'POST', cuerpo: archivo }));
      setVista(null); setArchivo(null);
    } catch (ex) {
      setError(ex.message);
    } finally {
      setCargando(false);
    }
  }

  const filas = vista?.filas.filter((f) => filtro === 'TODAS' || (filtro === 'AVISOS' ? f.estado === 'ADVERTENCIA' : f.estado === 'RECHAZADA')) ?? [];
  const importables = vista ? vista.resumen.ok + vista.resumen.advertencias : 0;
  const Chip = ({ id, texto, n }) => (
    <button onClick={() => setFiltro(id)} className={`rounded-full border px-3 py-1 text-sm ${filtro === id ? 'border-blue-600 bg-blue-50 text-blue-700' : 'bg-white'}`}>{texto} ({n})</button>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link to="/clientes" className="text-sm text-blue-700 hover:underline">← Volver a clientes</Link>
        <h1 className="mt-2 text-xl font-semibold">Importar clientes desde Excel</h1>
      </div>

      <section className="space-y-3 rounded-lg border bg-white p-4 sm:p-6">
        <p className="text-sm text-slate-600">
          Sube una planilla Excel (.xlsx) o CSV con tus clientes. El sistema reconoce las columnas por su nombre
          (Nombre, CUIT, Correo, Celular, Localidad…), te muestra una vista previa y <strong>no guarda nada hasta que confirmes</strong>.
          Si lo importas dos veces, los clientes que ya existen se omiten.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className={`btn-primario cursor-pointer ${cargando ? 'opacity-50' : ''}`}>
            {cargando ? 'Procesando…' : archivo ? 'Elegir otro archivo' : 'Elegir archivo'}
            <input type="file" className="sr-only" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={elegir} disabled={cargando} />
          </label>
          <a className="text-sm text-blue-700 hover:underline" href="/api/importacion/plantilla">Descargar plantilla de ejemplo</a>
          {archivo && <span className="text-sm text-slate-500">{archivo.name}</span>}
        </div>
      </section>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {resultado && (
        <div role="status" className="space-y-1 rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-medium">Importación terminada: {resultado.creados} clientes creados.</p>
          <p>Omitidos por duplicados o sin nombre: {resultado.rechazadas}. Con datos para revisar: {resultado.conAdvertencias}.{resultado.fallidos > 0 && ` No se pudieron crear: ${resultado.fallidos}.`}</p>
          <Link to="/clientes" className="inline-block text-blue-700 hover:underline">Ver clientes →</Link>
        </div>
      )}

      {vista && (
        <>
          <section className="space-y-3 rounded-lg border bg-white p-4 sm:p-6">
            <h2 className="font-semibold">1. Columnas reconocidas</h2>
            <p className="text-sm text-slate-600">Revisa que cada columna de tu planilla corresponda al dato correcto; si no, cámbialo.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {vista.encabezados.map((enc, i) => enc && (
                <label key={i} className="text-xs text-slate-600">
                  “{enc}”
                  <select className="campo mt-0.5" value={vista.mapeo[i] || ''} onChange={(e) => cambiarColumna(i, e.target.value)} disabled={cargando}>
                    <option value="">(ignorar)</option>
                    {Object.entries(vista.campos).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-3 rounded-lg border bg-white p-4 sm:p-6">
            <h2 className="font-semibold">2. Vista previa</h2>
            <div className="flex flex-wrap gap-2">
              <Chip id="TODAS" texto="Todas" n={vista.resumen.total} />
              <Chip id="AVISOS" texto="Para revisar" n={vista.resumen.advertencias} />
              <Chip id="RECHAZADAS" texto="Se omiten" n={vista.resumen.rechazadas} />
            </div>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-slate-100 text-xs uppercase text-slate-500">
                  <tr><th className="px-3 py-2">Fila</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">CUIT</th><th className="px-3 py-2">Quedará como</th><th className="px-3 py-2">Resultado</th></tr>
                </thead>
                <tbody className="divide-y">
                  {filas.slice(0, MAX_VISIBLES).map((f) => (
                    <tr key={f.n} className="align-top">
                      <td className="px-3 py-2 text-slate-500">{f.n}</td>
                      <td className="px-3 py-2 font-medium">{f.datos?.razonSocial || f.nombre || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2">{f.datos?.cuit || '—'}</td>
                      <td className="px-3 py-2">{f.datos ? ESTADO_CLIENTE[f.datos.estado] : '—'}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ESTILO[f.estado]}`}>{NOMBRE[f.estado]}</span>
                        {f.motivo && <p className="mt-1 text-xs text-red-700">{f.motivo}</p>}
                        {f.advertencias.map((a, i) => <p key={i} className="mt-1 text-xs text-amber-800">{a}</p>)}
                      </td>
                    </tr>
                  ))}
                  {filas.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No hay filas en esta categoría.</td></tr>}
                </tbody>
              </table>
            </div>
            {filas.length > MAX_VISIBLES && <p className="text-xs text-slate-500">Se muestran las primeras {MAX_VISIBLES} de {filas.length}.</p>}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button className="btn-primario" onClick={importar} disabled={cargando || importables === 0}>
                Importar {importables} clientes
              </button>
              {vista.resumen.advertencias > 0 && <span className="text-sm text-amber-800">Los marcados “Revisar” se importan igual; después puedes completarlos.</span>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
