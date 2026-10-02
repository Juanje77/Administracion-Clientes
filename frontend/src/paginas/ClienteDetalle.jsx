import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import Estado from '../componentes/Estado';
import TareasCliente from '../componentes/TareasCliente';
import VencimientosCliente from '../componentes/VencimientosCliente';

const TIPOS = { LLAMADA: 'Llamada', REUNION: 'Reunión', MENSAJE: 'Mensaje', NOTA: 'Nota' };
const fecha = (d) => new Date(d).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

function Dato({ titulo, valor }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{titulo}</dt>
      <dd className="text-sm">{valor || '—'}</dd>
    </div>
  );
}

export default function ClienteDetalle() {
  const { id } = useParams();
  const { usuario } = useAuth();
  const navegar = useNavigate();
  const [c, setC] = useState(null);
  const [interacciones, setInteracciones] = useState([]);
  const [nueva, setNueva] = useState({ tipo: 'NOTA', detalle: '' });
  const [error, setError] = useState('');
  const [catalogo, setCatalogo] = useState([]);

  const cargar = () => {
    api(`/clientes/${id}`).then(setC).catch((e) => setError(e.message));
    api(`/clientes/${id}/interacciones`).then(setInteracciones).catch(() => {});
  };
  useEffect(cargar, [id]);
  useEffect(() => { api('/calendarios/catalogo').then(setCatalogo).catch(() => {}); }, []);

  async function agregar(e) {
    e.preventDefault();
    try {
      await api(`/clientes/${id}/interacciones`, { metodo: 'POST', cuerpo: nueva });
      setNueva({ tipo: nueva.tipo, detalle: '' });
      cargar();
    } catch (ex) {
      setError(ex.message);
    }
  }
  async function borrarInteraccion(iid) {
    if (!confirm('¿Borrar esta interacción?')) return;
    await api(`/clientes/${id}/interacciones/${iid}`, { metodo: 'DELETE' });
    cargar();
  }
  async function archivar() {
    if (!confirm('¿Archivar este cliente? Pasará a estado Inactivo.')) return;
    await api(`/clientes/${id}`, { metodo: 'DELETE' });
    cargar();
  }
  async function borrarDefinitivo() {
    if (!confirm('Se borrará el cliente y todo su historial. Esta acción no se puede deshacer. ¿Continuar?')) return;
    await api(`/clientes/${id}?definitivo=true`, { metodo: 'DELETE' });
    navegar('/clientes');
  }

  if (error && !c) return <p role="alert" className="text-red-600">{error}</p>;
  if (!c) return <p className="text-slate-500">Cargando…</p>;

  return (
    <div className="space-y-6">
      <Link to="/clientes" className="text-sm text-blue-700 hover:underline">← Volver a clientes</Link>
      <section className="rounded-lg border bg-white p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{c.razonSocial}</h1>
          <Estado estado={c.estado} />
          <div className="ml-auto flex gap-2">
            <Link to={`/clientes/${id}/editar`} className="btn-sec">Editar</Link>
            {c.estado !== 'INACTIVO' && <button className="btn-sec" onClick={archivar}>Archivar</button>}
            {usuario.rol === 'ADMIN' && <button className="btn-peligro" onClick={borrarDefinitivo}>Eliminar</button>}
          </div>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Dato titulo="CUIT / CUIL" valor={c.cuit} />
          <Dato titulo="Email" valor={c.email} />
          <Dato titulo="Teléfono" valor={c.telefono} />
          <Dato titulo="Dirección" valor={c.direccion} />
          <Dato titulo="Ciudad" valor={c.ciudad} />
          <Dato titulo="Tipo de persona" valor={c.tipoPersona === 'FISICA' ? 'Física' : c.tipoPersona === 'JURIDICA' ? 'Jurídica' : ''} />
          <Dato titulo="Condición IVA" valor={c.condicionIva} />
          <Dato titulo="Régimen" valor={c.regimen} />
          <Dato titulo="Etiquetas" valor={c.etiquetas.map((t) => t.nombre).join(', ')} />
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs text-slate-500">Obligaciones impositivas</dt>
            <dd className="text-sm">
              {c.obligaciones.length === 0 ? '—' : c.obligaciones.map((k) => catalogo.find((o) => o.clave === k)?.titulo || k).join(' · ')}
            </dd>
          </div>
        </dl>
        {c.notas && <p className="mt-4 whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{c.notas}</p>}
      </section>

      <TareasCliente clienteId={id} />
      <VencimientosCliente clienteId={id} />

      <section className="rounded-lg border bg-white p-4 sm:p-6">
        <h2 className="mb-3 font-semibold">Historial de interacciones</h2>
        <form onSubmit={agregar} className="mb-4 flex flex-col gap-2 sm:flex-row">
          <select className="campo sm:w-40" value={nueva.tipo} onChange={(e) => setNueva({ ...nueva, tipo: e.target.value })} aria-label="Tipo">
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="campo" required placeholder="Detalle de la interacción" value={nueva.detalle} onChange={(e) => setNueva({ ...nueva, detalle: e.target.value })} aria-label="Detalle" />
          <button className="btn-primario">Agregar</button>
        </form>
        {error && <p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}
        <ul className="divide-y">
          {interacciones.map((i) => (
            <li key={i.id} className="flex items-start gap-3 py-2 text-sm">
              <span className="w-20 shrink-0 rounded bg-blue-50 px-2 py-0.5 text-center text-xs text-blue-700">{TIPOS[i.tipo]}</span>
              <div className="flex-1">
                <p className="whitespace-pre-wrap">{i.detalle}</p>
                <p className="text-xs text-slate-500">{fecha(i.fecha)} · {i.usuario.nombre}</p>
              </div>
              {(i.usuario.id === usuario.id || usuario.rol === 'ADMIN') && (
                <button className="text-xs text-red-600 hover:underline" onClick={() => borrarInteraccion(i.id)}>Borrar</button>
              )}
            </li>
          ))}
          {interacciones.length === 0 && <li className="py-4 text-center text-sm text-slate-500">Sin interacciones registradas.</li>}
        </ul>
      </section>
    </div>
  );
}
