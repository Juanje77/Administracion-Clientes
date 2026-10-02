import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api, ErrorApi } from '../api';

const VACIO = {
  razonSocial: '', cuit: '', email: '', telefono: '', direccion: '', ciudad: '', notas: '',
  estado: 'POTENCIAL', tipoPersona: '', condicionIva: '', regimen: '', etiquetas: '', obligaciones: [], abonoMensual: '', recordatorios: true,
};
const CONDICIONES_IVA = ['Responsable Inscripto', 'Monotributista', 'Exento', 'Consumidor Final', 'No Responsable'];

function Campo({ etiqueta, error, children }) {
  return (
    <div>
      <label className="etiqueta-label">{etiqueta}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function ClienteForm() {
  const { id } = useParams();
  const navegar = useNavigate();
  const [f, setF] = useState(VACIO);
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState('');
  const [catalogo, setCatalogo] = useState([]);

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
    <form onSubmit={guardar} className="space-y-4 rounded-lg border bg-white p-4 sm:p-6">
      <h1 className="text-xl font-semibold">{id ? 'Editar cliente' : 'Nuevo cliente'}</h1>
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
        <Campo etiqueta={`Condición frente al IVA${f.estado === 'ACTIVO' ? ' *' : ''}`} error={err('condicionIva')}>
          <select className="campo" value={f.condicionIva} onChange={set('condicionIva')}>
            <option value="">—</option>
            {CONDICIONES_IVA.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Campo>
        <div className="sm:col-span-2">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={f.recordatorios !== false} onChange={(e) => setF({ ...f, recordatorios: e.target.checked })} />
            <span>Enviarle recordatorios por email de vencimientos y honorarios pendientes <span className="text-slate-500">(solo si tiene email y el administrador activó los recordatorios en <em>Avisos</em>)</span></span>
          </label>
        </div>
        <Campo etiqueta="Abono mensual (honorarios, en $)" error={err('abonoMensual')}>
          <input type="number" step="0.01" min="0" className="campo" placeholder="Ej. 85000" value={f.abonoMensual} onChange={set('abonoMensual')} />
        </Campo>
        <Campo etiqueta="Régimen (Ganancias, IIBB, etc.)">
          <input className="campo" value={f.regimen} onChange={set('regimen')} />
        </Campo>
        <div className="sm:col-span-2">
          <Campo etiqueta="Etiquetas (separadas por coma)">
            <input className="campo" placeholder="monotributo, sueldos" value={f.etiquetas} onChange={set('etiquetas')} />
          </Campo>
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta-label">Obligaciones impositivas (generan los vencimientos del calendario)</label>
          {catalogo.length === 0 ? (
            <p className="text-sm text-slate-500">Carga primero un calendario en la sección <Link className="text-blue-700 hover:underline" to="/calendario">Calendario</Link> para poder marcar las obligaciones.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border border-slate-300 p-2">
              {catalogo.map((o, i) => (
                <div key={o.clave}>
                  {o.seccion !== catalogo[i - 1]?.seccion && <p className="mt-1 text-xs font-semibold uppercase text-slate-500">{o.seccion}</p>}
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
      {errorGeneral && <p role="alert" className="text-sm text-red-600">{errorGeneral}</p>}
      <div className="flex gap-2">
        <button className="btn-primario">Guardar</button>
        <Link to={id ? `/clientes/${id}` : '/clientes'} className="btn-sec">Cancelar</Link>
      </div>
    </form>
  );
}
