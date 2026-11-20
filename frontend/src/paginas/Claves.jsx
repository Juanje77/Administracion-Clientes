import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import Alerta from '../componentes/Alerta';

const SEGUNDOS = 15; // tiempo que una clave queda a la vista
const NOMBRE = { arca: 'ARCA', rentas: 'Rentas' };

// Celda de una clave: se muestra o se copia solo cuando se pide (y cada vez queda registrado).
function CeldaClave({ cliente, campo, alError }) {
  const cargada = cliente[campo];
  const [visible, setVisible] = useState(null);
  const [copiado, setCopiado] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pedir = () => api(`/claves/${cliente.id}/${campo}`).then((r) => r.clave);
  async function ver() {
    if (visible !== null) { setVisible(null); return; }
    try {
      setVisible(await pedir());
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(null), SEGUNDOS * 1000);
    } catch (e) { alError(e.message); }
  }
  async function copiar() {
    try {
      await navigator.clipboard.writeText(await pedir());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch (e) { alError(e.message || 'No se pudo copiar'); }
  }
  if (!cargada) return <span className="text-machine">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="min-w-[8ch] font-mono text-[14px]">{visible !== null ? visible : '••••••••'}</span>
      <button className="py-1 text-xs enlace" onClick={ver} aria-label={`${visible !== null ? 'Ocultar' : 'Ver'} la clave de ${NOMBRE[campo]} de ${cliente.razonSocial}`}>{visible !== null ? 'Ocultar' : 'Ver'}</button>
      <button className="py-1 text-xs enlace" onClick={copiar} aria-label={`Copiar la clave de ${NOMBRE[campo]} de ${cliente.razonSocial}`}>{copiado ? '¡Copiada!' : 'Copiar'}</button>
    </span>
  );
}

function Editor({ cliente, alGuardar, alCancelar }) {
  const [f, setF] = useState({ arca: '', rentas: '' });
  const [quitar, setQuitar] = useState({ arca: false, rentas: false });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  async function guardar(e) {
    e.preventDefault();
    const cuerpo = {};
    for (const c of ['arca', 'rentas']) {
      if (quitar[c]) cuerpo[c] = '';
      else if (f[c]) cuerpo[c] = f[c];
    }
    if (Object.keys(cuerpo).length === 0) { alCancelar(); return; }
    setError(''); setGuardando(true);
    try { await api(`/claves/${cliente.id}`, { metodo: 'PUT', cuerpo }); alGuardar(); } catch (ex) { setError(ex.message); setGuardando(false); }
  }
  return (
    <form onSubmit={guardar} className="space-y-3 border border-regla bg-white p-4">
      <p className="text-sm font-medium">Claves de {cliente.razonSocial}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {['arca', 'rentas'].map((c) => (
          <div key={c}>
            <label className="etiqueta-label" htmlFor={`${cliente.id}-${c}`}>Clave de {NOMBRE[c]}</label>
            <input id={`${cliente.id}-${c}`} className="campo font-mono" type="text" autoComplete="off" spellCheck={false} disabled={quitar[c]}
              placeholder={cliente[c] ? '(dejar vacío para no cambiarla)' : 'Sin clave cargada'} value={f[c]} onChange={(e) => setF({ ...f, [c]: e.target.value })} />
            {cliente[c] && (
              <label className="mt-1 flex items-center gap-2 text-xs text-machine">
                <input type="checkbox" checked={quitar[c]} onChange={(e) => setQuitar({ ...quitar, [c]: e.target.checked })} /> Borrar esta clave
              </label>
            )}
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

function Registro() {
  const [lista, setLista] = useState(null);
  useEffect(() => { api('/claves/accesos').then(setLista).catch(() => setLista([])); }, []);
  const TIPO = { ver: 'Vio', editar: 'Cambió', borrar: 'Borró' };
  if (!lista) return <p className="text-sm text-machine">Cargando…</p>;
  return (
    <ul className="divide-y border-y text-sm">
      {lista.map((a) => (
        <li key={a.id} className="flex flex-wrap gap-x-3 py-2">
          <span className="w-40 text-machine">{new Date(a.fecha).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</span>
          <span><strong>{a.usuarioNombre}</strong> {TIPO[a.tipo]} la clave de {NOMBRE[a.campo]} de {a.clienteNombre}</span>
        </li>
      ))}
      {lista.length === 0 && <li className="py-3 text-machine">Todavía no hay accesos registrados.</li>}
    </ul>
  );
}

export default function Claves() {
  const { usuario } = useAuth();
  const [lista, setLista] = useState(null);
  const [q, setQ] = useState('');
  const [soloActivos, setSoloActivos] = useState(true);
  const [editando, setEditando] = useState(null);
  const [verRegistro, setVerRegistro] = useState(false);
  const [error, setError] = useState('');

  const cargar = () => api('/claves').then((l) => { setLista(l); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  const texto = q.trim().toLowerCase();
  const visibles = (lista || []).filter((c) => (!soloActivos || c.estado === 'ACTIVO') && (!texto || c.razonSocial.toLowerCase().includes(texto) || (c.cuit || '').replace(/\D/g, '').includes(texto.replace(/\D/g, '') || '\u0000')));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="titulo-pagina">CUIT y claves</h1>
        {usuario.rol === 'ADMIN' && <button className="enlace text-[14px]" onClick={() => setVerRegistro(!verRegistro)}>{verRegistro ? 'Ocultar el registro de accesos' : 'Ver quién consultó las claves'}</button>}
      </div>
      <p className="text-sm text-machine">
        Las claves se guardan cifradas. No se muestran hasta que tocás <em>Ver</em> o <em>Copiar</em>, y cada consulta queda registrada. Cada persona ve solo los clientes que tiene asignados.
      </p>
      {error && <Alerta tipo="error">{error}</Alerta>}
      {verRegistro && <Registro />}

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
                  <td className="whitespace-nowrap px-3 py-2">{c.cuit || <span className="text-machine">—</span>}</td>
                  <td className="px-3 py-2"><CeldaClave cliente={c} campo="arca" alError={setError} /></td>
                  <td className="px-3 py-2"><CeldaClave cliente={c} campo="rentas" alError={setError} /></td>
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
