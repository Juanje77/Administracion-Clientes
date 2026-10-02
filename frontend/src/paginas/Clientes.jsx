import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import Estado from '../componentes/Estado';

const COLUMNAS = [
  ['razonSocial', 'Razón social'],
  ['cuit', 'CUIT'],
  ['email', 'Email'],
  ['telefono', 'Teléfono'],
  ['ciudad', 'Ciudad'],
  ['estado', 'Estado'],
];

export default function Clientes() {
  const [filtros, setFiltros] = useState({ q: '', estado: '', ciudad: '', etiqueta: '' });
  const [orden, setOrden] = useState({ campo: 'razonSocial', dir: 'asc' });
  const [pagina, setPagina] = useState(1);
  const [resultado, setResultado] = useState({ total: 0, datos: [], porPagina: 25 });
  const [ciudades, setCiudades] = useState([]);
  const [etiquetas, setEtiquetas] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/clientes/ciudades').then(setCiudades).catch(() => {});
    api('/clientes/etiquetas').then(setEtiquetas).catch(() => {});
  }, []);

  useEffect(() => {
    // Pequeña espera para no consultar en cada tecla.
    const t = setTimeout(() => {
      const p = new URLSearchParams({ orden: orden.campo, dir: orden.dir, pagina });
      Object.entries(filtros).forEach(([k, v]) => v && p.set(k, v));
      api(`/clientes?${p}`).then(setResultado).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [filtros, orden, pagina]);

  const cambiarFiltro = (campo) => (e) => {
    setFiltros({ ...filtros, [campo]: e.target.value });
    setPagina(1);
  };
  const ordenarPor = (campo) =>
    setOrden({ campo, dir: orden.campo === campo && orden.dir === 'asc' ? 'desc' : 'asc' });
  const paginas = Math.max(1, Math.ceil(resultado.total / resultado.porPagina));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Clientes <span className="text-sm font-normal text-slate-500">({resultado.total})</span></h1>
        <Link to="/clientes/nuevo" className="btn-primario">+ Nuevo cliente</Link>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <input className="campo" placeholder="Buscar nombre, email, teléfono o CUIT" value={filtros.q} onChange={cambiarFiltro('q')} aria-label="Buscar" />
        <select className="campo" value={filtros.estado} onChange={cambiarFiltro('estado')} aria-label="Estado">
          <option value="">Todos los estados</option>
          <option value="ACTIVO">Activo</option>
          <option value="POTENCIAL">Potencial</option>
          <option value="INACTIVO">Inactivo</option>
        </select>
        <select className="campo" value={filtros.ciudad} onChange={cambiarFiltro('ciudad')} aria-label="Ciudad">
          <option value="">Todas las ciudades</option>
          {ciudades.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select className="campo" value={filtros.etiqueta} onChange={cambiarFiltro('etiqueta')} aria-label="Etiqueta">
          <option value="">Todas las etiquetas</option>
          {etiquetas.map((t) => <option key={t.id}>{t.nombre}</option>)}
        </select>
      </div>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {COLUMNAS.map(([campo, titulo]) => (
                <th key={campo} className="cursor-pointer select-none whitespace-nowrap px-3 py-2" onClick={() => ordenarPor(campo)}>
                  {titulo} {orden.campo === campo ? (orden.dir === 'asc' ? '▲' : '▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {resultado.datos.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-medium"><Link className="text-blue-700 hover:underline" to={`/clientes/${c.id}`}>{c.razonSocial}</Link></td>
                <td className="px-3 py-2">{c.cuit}</td>
                <td className="px-3 py-2">{c.email}</td>
                <td className="px-3 py-2">{c.telefono}</td>
                <td className="px-3 py-2">{c.ciudad}</td>
                <td className="px-3 py-2"><Estado estado={c.estado} /></td>
              </tr>
            ))}
            {resultado.datos.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No hay clientes que coincidan.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <button className="btn-sec" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>← Anterior</button>
        <span>Página {pagina} de {paginas}</span>
        <button className="btn-sec" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente →</button>
      </div>
    </div>
  );
}
