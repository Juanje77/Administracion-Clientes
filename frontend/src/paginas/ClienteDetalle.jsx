import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import Estado from '../componentes/Estado';
import TareasCliente from '../componentes/TareasCliente';
import VencimientosCliente from '../componentes/VencimientosCliente';
import HonorariosCliente from '../componentes/HonorariosCliente';
import DocumentosCliente from '../componentes/DocumentosCliente';
import Alerta from '../componentes/Alerta';

const TIPOS = { LLAMADA: 'Llamada', REUNION: 'Reunión', MENSAJE: 'Mensaje', NOTA: 'Nota' };
const fecha = (d) => new Date(d).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

function Dato({ titulo, valor }) {
  return (
    <div>
      <dt className="text-xs text-machine">{titulo}</dt>
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

  if (error && !c) return <Alerta tipo="error">{error}</Alerta>;
  if (!c) return <p className="text-machine">Cargando…</p>;

  return (
    <div className="space-y-6">
      <Link to="/clientes" className="text-sm enlace">← Volver a clientes</Link>
      <section className="panel">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="titulo-pagina">{c.razonSocial}</h1>
          <Estado estado={c.estado} />
          <div className="ml-auto flex gap-2">
            <Link to={`/clientes/${id}/editar`} className="btn-sec btn-sm">Editar</Link>
            {c.estado !== 'INACTIVO' && <button className="btn-sec btn-sm" onClick={archivar}>Archivar</button>}
            {usuario.rol === 'ADMIN' && <button className="btn-peligro btn-sm" onClick={borrarDefinitivo}>Eliminar</button>}
          </div>
        </div>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Dato titulo="CUIT / CUIL" valor={c.cuit} />
          <Dato titulo="Email" valor={c.email} />
          <Dato titulo="Teléfono" valor={c.telefono} />
          <Dato titulo="Dirección" valor={c.direccion} />
          <Dato titulo="Ciudad" valor={c.ciudad} />
          <Dato titulo="Tipo de persona" valor={c.tipoPersona === 'FISICA' ? 'Física' : c.tipoPersona === 'JURIDICA' ? 'Jurídica' : ''} />
          {c.tipoPersona === 'JURIDICA' && <Dato titulo="Cierre de balance" valor={c.cierreMes ? ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][c.cierreMes - 1] : 'Sin cargar'} />}
          <Dato titulo="Condición IVA" valor={c.condicionIva} />
          <Dato titulo="Régimen" valor={c.regimen} />
          <Dato titulo="Etiquetas" valor={c.etiquetas.map((t) => t.nombre).join(', ')} />
          <div className="sm:col-span-2 lg:col-span-3">
            <dt className="text-xs text-machine">Obligaciones impositivas</dt>
            <dd className="text-sm">
              {c.obligaciones.length === 0 ? '—' : c.obligaciones.map((k) => catalogo.find((o) => o.clave === k)?.titulo || k).join(' · ')}
            </dd>
          </div>
        </dl>
        {c.notas && <p className="mt-4 whitespace-pre-wrap border-l-2 border-figure pl-4 text-sm">{c.notas}</p>}
      </section>

      {usuario.verDinero && <HonorariosCliente clienteId={id} abonoMensual={c.abonoMensual} />}
      <DocumentosCliente clienteId={id} />
      <TareasCliente clienteId={id} clienteNombre={c.razonSocial} />
      <VencimientosCliente clienteId={id} />

      <section className="panel">
        <h2 className="titulo-seccion mb-3">Historial de interacciones</h2>
        <form onSubmit={agregar} className="mb-4 flex flex-col gap-2 sm:flex-row">
          <select className="campo sm:w-40" value={nueva.tipo} onChange={(e) => setNueva({ ...nueva, tipo: e.target.value })} aria-label="Tipo">
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="campo" required placeholder="Detalle de la interacción" value={nueva.detalle} onChange={(e) => setNueva({ ...nueva, detalle: e.target.value })} aria-label="Detalle" />
          <button className="btn-primario">Agregar</button>
        </form>
        {error && <Alerta tipo="error">{error}</Alerta>}
        <ul className="divide-y">
          {interacciones.map((i) => (
            <li key={i.id} className="flex items-start gap-3 py-2 text-sm">
              <span className="insignia-gris w-24 shrink-0 justify-center">{TIPOS[i.tipo]}</span>
              <div className="flex-1">
                <p className="whitespace-pre-wrap">{i.detalle}</p>
                <p className="text-xs text-machine">{fecha(i.fecha)} · {i.usuario.nombre}</p>
              </div>
              {(i.usuario.id === usuario.id || usuario.rol === 'ADMIN') && (
                <button className="text-xs enlace-tenue" onClick={() => borrarInteraccion(i.id)}>Borrar</button>
              )}
            </li>
          ))}
          {interacciones.length === 0 && <li className="py-4 text-center text-sm text-machine">Sin interacciones registradas.</li>}
        </ul>
      </section>
    </div>
  );
}
