import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, ErrorApi } from '../api';
import { useAuth } from '../auth';
import Alerta from '../componentes/Alerta';

const VACIO = {
  razonSocial: '', cuit: '', email: '', telefono: '', direccion: '', ciudad: '', notas: '',
  estado: 'POTENCIAL', responsables: [], tipoPersona: '', cierreMes: '', condicionIva: '', regimen: '', etiquetas: '', obligaciones: [], abonoMensual: '', recordatorios: true,
};
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CONDICIONES_IVA = ['Responsable Inscripto', 'Monotributista', 'Exento', 'Consumidor Final', 'No Responsable'];

function Campo({ etiqueta, error, children }) {
  return (
    <div>
      <label className="etiqueta-label">{etiqueta}</label>
      {children}
      {error && <p className="mt-1 text-xs text-figure">{error}</p>}
    </div>
  );
}

export default function ClienteForm() {
  const { usuario } = useAuth();
  const { id } = useParams();
  const navegar = useNavigate();
  const [f, setF] = useState(VACIO);
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState('');
  const [catalogo, setCatalogo] = useState([]);
  const [equipo, setEquipo] = useState([]); // solo administradores: personas con acceso limitado a clientes

  useEffect(() => {
    if (usuario.rol === 'ADMIN') api('/usuarios').then((l) => setEquipo(l.filter((x) => x.rol !== 'ADMIN' && x.activo))).catch(() => {});
  }, [usuario.rol]);

  useEffect(() => { api('/calendarios/catalogo').then(setCatalogo).catch(() => {}); }, []);

  useEffect(() => {
    if (!id) return;
    api(`/clientes/${id}`).then((c) =>
      setF({
        ...VACIO,
        ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? ''])),
        etiquetas: c.etiquetas.map((t) => t.nombre).join(', '),
      })
    );
  }, [id]);

  const set = (campo) => (e) => setF({ ...f, [campo]: e.target.value });
  const err = (campo) => errores[campo]?.[0];

  async function guardar(e) {
    e.preventDefault();
    setErrores({});
    setErrorGeneral('');
    const cuerpo = {
      ...f,
      etiquetas: f.etiquetas.split(',').map((t) => t.trim()).filter(Boolean),
    };
    try {
      const c = await api(id ? `/clientes/${id}` : '/clientes', { metodo: id ? 'PUT' : 'POST', cuerpo });
      navegar(`/clientes/${c.id}`);
    } catch (ex) {
      if (ex instanceof ErrorApi) {
        setErrores(ex.detalles);
        setErrorGeneral(ex.message);
      } else throw ex;
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-4 panel">
      <h1 className="titulo-pagina">{id ? 'Editar cliente' : 'Nuevo cliente'}</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Nombre / Razón social *" error={err('razonSocial')}>
          <input className="campo" required value={f.razonSocial} onChange={set('razonSocial')} />
        </Campo>
        <Campo etiqueta="CUIT / CUIL" error={err('cuit')}>
          <input className="campo" placeholder="20-12345678-6" value={f.cuit} onChange={set('cuit')} />
        </Campo>
        <Campo etiqueta="Email" error={err('email')}>
          <input type="email" className="campo" value={f.email} onChange={set('email')} />
        </Campo>
        <Campo etiqueta="Teléfono" error={err('telefono')}>
          <input className="campo" value={f.telefono} onChange={set('telefono')} />
        </Campo>
        <Campo etiqueta="Dirección" error={err('direccion')}>
          <input className="campo" value={f.direccion} onChange={set('direccion')} />
        </Campo>
        <Campo etiqueta="Ciudad" error={err('ciudad')}>
          <input className="campo" value={f.ciudad} onChange={set('ciudad')} />
        </Campo>
        <Campo etiqueta="Estado">
          <select className="campo" value={f.estado} onChange={set('estado')}>
            <option value="POTENCIAL">Potencial</option>
            <option value="ACTIVO">Activo</option>
            <option value="INACTIVO">Inactivo</option>
          </select>
        </Campo>
        <Campo etiqueta="Tipo de persona">
          <select className="campo" value={f.tipoPersona} onChange={set('tipoPersona')}>
            <option value="">—</option>
            <option value="FISICA">Física</option>
            <option value="JURIDICA">Jurídica</option>
          </select>
        </Campo>
        {f.tipoPersona === 'JURIDICA' && (
          <Campo etiqueta={`Mes de cierre del balance${f.estado === 'ACTIVO' ? ' *' : ''}`} error={err('cierreMes')}>
            <select className="campo" value={f.cierreMes} onChange={set('cierreMes')}>
              <option value="">—</option>
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <p className="mt-1 text-xs text-machine">Define cuándo vence su DDJJ de Ganancias Sociedades (marcá esa obligación más abajo).</p>
          </Campo>
        )}
        <Campo etiqueta={`Condición frente al IVA${f.estado === 'ACTIVO' ? ' *' : ''}`} error={err('condicionIva')}>
          <select className="campo" value={f.condicionIva} onChange={set('condicionIva')}>
            <option value="">—</option>
            {CONDICIONES_IVA.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Campo>
        <div className="sm:col-span-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={f.recordatorios !== false} onChange={(e) => setF({ ...f, recordatorios: e.target.checked })} />
            <span>Enviarle recordatorios por email de vencimientos y honorarios pendientes <span className="text-machine">(solo si tiene email y el administrador activó los recordatorios en <em>Avisos</em>)</span></span>
          </label>
        </div>
        {usuario.verDinero && (
          <Campo etiqueta="Abono mensual (honorarios, en $)" error={err('abonoMensual')}>
            <input type="number" step="0.01" min="0" className="campo" placeholder="Ej. 85000" value={f.abonoMensual} onChange={set('abonoMensual')} />
          </Campo>
        )}
        <Campo etiqueta="Régimen (Ganancias, IIBB, etc.)">
          <input className="campo" value={f.regimen} onChange={set('regimen')} />
        </Campo>
        <div className="sm:col-span-2">
          <Campo etiqueta="Etiquetas (separadas por coma)">
            <input className="campo" placeholder="monotributo, sueldos" value={f.etiquetas} onChange={set('etiquetas')} />
          </Campo>
        </div>
        {usuario.rol === 'ADMIN' && equipo.length > 0 && (
          <div className="sm:col-span-2">
            <label className="etiqueta-label">Quién puede ver este cliente</label>
            <p className="mb-2 text-xs text-machine">Los administradores y quienes tienen acceso a todos los clientes lo ven siempre. Marcá a quién más.</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {equipo.map((p) => (
                <label key={p.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={(f.responsables || []).includes(p.id)}
                    onChange={(e) => setF({ ...f, responsables: e.target.checked ? [...(f.responsables || []), p.id] : (f.responsables || []).filter((x) => x !== p.id) })}
                  />
                  {p.nombre}{p.todosLosClientes && <span className="text-machine"> (ya ve todos)</span>}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="etiqueta-label">Obligaciones impositivas (generan los vencimientos del calendario)</label>
          {catalogo.length === 0 ? (
            <p className="text-sm text-machine">Carga primero un calendario en la sección <Link className="enlace" to="/calendario">Calendario</Link> para poder marcar las obligaciones.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-panel border p-3">
              {catalogo.map((o, i) => (
                <div key={o.clave}>
                  {o.seccion !== catalogo[i - 1]?.seccion && <p className="mt-1 text-xs font-medium uppercase text-machine">{o.seccion}</p>}
                  <label className="flex items-center gap-2 py-0.5 text-sm">
                    <input type="checkbox" checked={f.obligaciones.includes(o.clave)}
                      onChange={(e) => setF({ ...f, obligaciones: e.target.checked ? [...f.obligaciones, o.clave] : f.obligaciones.filter((x) => x !== o.clave) })} />
                    {o.titulo}
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="sm:col-span-2">
          <Campo etiqueta="Notas">
            <textarea rows={4} className="campo" value={f.notas} onChange={set('notas')} />
          </Campo>
        </div>
      </div>
      {errorGeneral && <Alerta tipo="error">{errorGeneral}</Alerta>}
      <div className="flex gap-2">
        <button className="btn-primario">Guardar</button>
        <Link to={id ? `/clientes/${id}` : '/clientes'} className="btn-sec">Cancelar</Link>
      </div>
    </form>
  );
}
