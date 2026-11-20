import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import Alerta from '../componentes/Alerta';

const NOMBRE = { arca: 'ARCA', rentas: 'Rentas' };

// Texto con botón para copiarlo al portapapeles
function Copiable({ texto, etiqueta }) {
  const [ok, setOk] = useState(false);
  if (!texto) return <span className="text-machine">—</span>;
  async function copiar() {
    try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* sin permiso del navegador */ }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3">
      <span className="break-all font-mono text-[14px]">{texto}</span>
      <button className="py-1 text-xs enlace" onClick={copiar} aria-label={`Copiar ${etiqueta}`}>{ok ? '¡Copiada!' : 'Copiar'}</button>
    </span>
  );
}

function Editor({ cliente, alGuardar, alCancelar }) {
  const [f, setF] = useState({ arca: cliente.arca ?? '', rentas: cliente.rentas ?? '' });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  async function guardar(e) {
    e.preventDefault();
    setError(''); setGuardando(true);
    try { await api(`/claves/${cliente.id}`, { metodo: 'PUT', cuerpo: f }); alGuardar(); } catch (ex) { setError(ex.message); setGuardando(false); }
  }
  return (
    <form onSubmit={guardar} className="space-y-3 border border-regla bg-white p-4">
      <p className="text-sm font-medium">Claves de {cliente.razonSocial} <span className="font-normal text-machine">(dejá un campo vacío para borrar esa clave)</span></p>
      <div className="grid gap-3 sm:grid-cols-2">
        {['arca', 'rentas'].map((c) => (
          <div key={c}>
            <label className="etiqueta-label" htmlFor={`${cliente.id}-${c}`}>Clave de {NOMBRE[c]}</label>
            <input id={`${cliente.id}-${c}`} className="campo font-mono" type="text" autoComplete="off" spellCheck={false} value={f[c]} onChange={(e) => setF({ ...f, [c]: e.target.value })} />
          </div>
        ))}
      </div>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-primario" disabled={guardando}>Guardar</button>
        <button type="button" className="btn-sec" onClick={alCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

export default function Claves() {
  const [lista, setLista] = useState(null);
  const [q, setQ] = useState('');
  const [soloActivos, setSoloActivos] = useState(true);
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState('');

  const cargar = () => api('/claves').then((l) => { setLista(l); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  const texto = q.trim().toLowerCase();
  const digitos = texto.replace(/\D/g, '');
  const visibles = (lista || []).filter((c) => (!soloActivos || c.estado === 'ACTIVO')
    && (!texto || c.razonSocial.toLowerCase().includes(texto) || (digitos && (c.cuit || '').replace(/\D/g, '').includes(digitos))));

  return (
    <div className="space-y-6">
      <h1 className="titulo-pagina">CUIT y claves</h1>
      <p className="text-sm text-machine">CUIT y claves de ARCA y Rentas de cada cliente. Cada persona ve solo los clientes que tiene asignados.</p>
      {error && <Alerta tipo="error">{error}</Alerta>}

      <div className="flex flex-wrap items-center gap-4">
        <input className="campo !w-72" placeholder="Buscar por nombre o CUIT" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={soloActivos} onChange={(e) => setSoloActivos(e.target.checked)} /> Solo clientes activos</label>
        {lista && <span className="text-sm text-machine">{visibles.length} {visibles.length === 1 ? 'cliente' : 'clientes'}</span>}
      </div>

      <div className="overflow-x-auto panel-plano">
        <table className="w-full text-left text-sm">
          <thead className="encabezado-tabla">
            <tr><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">CUIT</th><th className="px-3 py-2">Clave de ARCA</th><th className="px-3 py-2">Clave de Rentas</th><th /></tr>
          </thead>
          <tbody className="divide-y">
            {visibles.map((c) => (
              <Fragment key={c.id}>
                <tr>
                  <td className="px-3 py-2 font-medium"><Link className="enlace" to={`/clientes/${c.id}`}>{c.razonSocial}</Link></td>
                  <td className="px-3 py-2"><Copiable texto={c.cuit} etiqueta={`el CUIT de ${c.razonSocial}`} /></td>
                  <td className="px-3 py-2"><Copiable texto={c.arca} etiqueta={`la clave de ARCA de ${c.razonSocial}`} /></td>
                  <td className="px-3 py-2"><Copiable texto={c.rentas} etiqueta={`la clave de Rentas de ${c.razonSocial}`} /></td>
                  <td className="px-3 py-2 text-right"><button className="btn-sec btn-sm" onClick={() => setEditando(editando === c.id ? null : c.id)}>{c.arca || c.rentas ? 'Editar' : 'Cargar'}</button></td>
                </tr>
                {editando === c.id && (
                  <tr><td colSpan={5} className="bg-fondo px-3 py-3"><Editor cliente={c} alGuardar={() => { setEditando(null); cargar(); }} alCancelar={() => setEditando(null)} /></td></tr>
                )}
              </Fragment>
            ))}
            {lista && visibles.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-machine">No hay clientes para mostrar.</td></tr>}
            {!lista && !error && <tr><td colSpan={5} className="px-3 py-8 text-center text-machine">Cargando…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
