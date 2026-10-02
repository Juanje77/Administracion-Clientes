import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { hoyISO } from '../formato';
import { verFecha } from '../fechas';
import Situacion from './Situacion';

// Avisa al resto de la aplicación (menú) que cambió algo de la agenda.
export const avisarAlertas = () => window.dispatchEvent(new Event('alertas'));

// Personas activas del equipo, para poder asignarles tareas.
export function useEquipo() {
  const [equipo, setEquipo] = useState([]);
  useEffect(() => { api('/usuarios/equipo').then(setEquipo).catch(() => {}); }, []);
  return equipo;
}

// Qué pasó con el email al asignar la tarea (el servidor lo informa en `aviso`).
export function textoAviso(r) {
  const quien = r.asignadoNombre || 'La persona';
  return {
    enviado: `Se avisó por email a ${quien}.`,
    desactivado: `${quien} tiene los avisos por email desactivados.`,
    'sin-correo': 'El correo no está configurado, así que no se envió el aviso.',
    error: 'La tarea se guardó, pero no se pudo enviar el aviso por email.',
  }[r.aviso] || '';
}

// Busca un cliente por nombre, CUIT, email o teléfono (opcional: una tarea puede ser interna).
export function SelectorCliente({ valor, onChange }) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState([]);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto) return undefined;
    const t = setTimeout(() => {
      api(`/clientes?q=${encodeURIComponent(q)}&porPagina=8`).then((r) => setResultados(r.datos)).catch(() => setResultados([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, abierto]);

  if (valor) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <span className="flex-1 truncate">{valor.nombre}</span>
        <button type="button" className="text-xs text-slate-500 hover:text-red-600" onClick={() => onChange(null)} aria-label="Quitar cliente">✕ Quitar</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input className="campo" placeholder="Buscar cliente… (déjalo vacío para una tarea interna)" value={q}
        onFocus={() => setAbierto(true)} onBlur={() => setTimeout(() => setAbierto(false), 150)} onChange={(e) => setQ(e.target.value)} aria-label="Cliente" />
      {abierto && resultados.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-white shadow">
          {resultados.map((c) => (
            <li key={c.id}>
              <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
                onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ id: c.id, nombre: c.razonSocial }); setAbierto(false); setQ(''); }}>
                {c.razonSocial} {c.cuit && <span className="text-xs text-slate-500">· {c.cuit}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Crear o editar una tarea. `clienteFijo` = se crea dentro de la ficha de un cliente (no se puede cambiar).
export function FormularioTarea({ tarea, clienteFijo, equipo, alGuardar, alCancelar }) {
  const { usuario } = useAuth();
  const [f, setF] = useState({ titulo: tarea?.titulo ?? '', descripcion: tarea?.descripcion ?? '', vence: tarea?.vence ?? hoyISO(), asignadoA: tarea?.asignadoA ?? usuario.id });
  const [cliente, setCliente] = useState(tarea?.clienteId ? { id: tarea.clienteId, nombre: tarea.clienteNombre } : null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar(e) {
    e.preventDefault();
    setError(''); setGuardando(true);
    const cuerpo = { ...f, clienteId: (clienteFijo ?? cliente)?.id ?? null };
    try {
      const r = await api(tarea ? `/tareas/${tarea.id}` : '/tareas', { metodo: tarea ? 'PATCH' : 'POST', cuerpo });
      avisarAlertas();
      alGuardar(r);
    } catch (ex) {
      setError(Object.values(ex.detalles || {}).flat()[0] || ex.message);
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/40 p-3 sm:p-4">
      <p className="text-sm font-medium">{tarea ? 'Editar tarea' : 'Nueva tarea'}</p>
      <div>
        <label className="etiqueta-label">Título *</label>
        <input className="campo" required autoFocus value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ej. Pedir facturas de compras" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="etiqueta-label">Asignar a *</label>
          <select className="campo" value={f.asignadoA} onChange={(e) => setF({ ...f, asignadoA: e.target.value })}>
            {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.id === usuario.id ? ' (yo)' : ''}</option>)}
          </select>
        </div>
        <div>
          <label className="etiqueta-label">Fecha límite *</label>
          <input className="campo" type="date" required value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} />
        </div>
      </div>
      {!clienteFijo && (
        <div>
          <label className="etiqueta-label">Cliente (opcional)</label>
          <SelectorCliente valor={cliente} onChange={setCliente} />
        </div>
      )}
      <div>
        <label className="etiqueta-label">Detalle (opcional)</label>
        <textarea rows={2} className="campo" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />
      </div>
      {f.asignadoA !== usuario.id && <p className="text-xs text-slate-500">Se le avisará por email (si el correo está configurado y no tiene los avisos desactivados).</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primario" disabled={guardando}>{tarea ? 'Guardar cambios' : 'Crear tarea'}</button>
        <button type="button" className="btn-sec" onClick={alCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

// Una tarea en una lista: casilla, título, detalle, cliente (o "Tarea interna"), fecha y responsable.
export function FilaTarea({ tarea: t, mostrarCliente = true, mostrarResponsable = true, alCompletar, alEditar, extra }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <input type="checkbox" checked={t.hecha} onChange={() => alCompletar(t)} aria-label={`${t.hecha ? 'Reabrir' : 'Completar'} ${t.titulo}`} className="mt-1 h-4 w-4" />
      <div className={`min-w-0 flex-1 ${t.hecha ? 'text-slate-400 line-through' : ''}`}>
        <p className="break-words">{t.titulo}</p>
        {t.descripcion && <p className="whitespace-pre-line break-words text-xs text-slate-500">{t.descripcion}</p>}
        <p className="text-xs text-slate-500">
          {mostrarCliente && (t.clienteId ? <><Link className="text-blue-700 hover:underline" to={`/clientes/${t.clienteId}`}>{t.clienteNombre}</Link> · </> : <>Tarea interna · </>)}
          {verFecha(t.vence)}{mostrarResponsable && ` · ${t.asignadoNombre || 'Sin asignar'}`}
        </p>
      </div>
      <Situacion valor={t.situacion} />
      {alEditar && <button className="text-xs text-blue-700 hover:underline" onClick={() => alEditar(t)}>Editar</button>}
      {extra}
    </div>
  );
}
