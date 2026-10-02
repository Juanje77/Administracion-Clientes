import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api';
import Alerta from '../componentes/Alerta';

// Panel para elegir qué clientes ve una persona (los mismos datos que "Quién puede ver este cliente" en la ficha).
function AsignarClientes({ usuario, cerrar, alGuardar }) {
  const [clientes, setClientes] = useState(null);
  const [marcados, setMarcados] = useState(new Set());
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    Promise.all([api('/clientes?porPagina=100&orden=razonSocial'), api(`/usuarios/${usuario.id}/clientes`)])
      .then(async ([primera, asignados]) => {
        let todos = primera.datos;
        for (let p = 2; todos.length < primera.total; p++) todos = todos.concat((await api(`/clientes?porPagina=100&orden=razonSocial&pagina=${p}`)).datos);
        setClientes(todos);
        setMarcados(new Set(asignados.map((c) => c.id)));
      })
      .catch((e) => setError(e.message));
  }, [usuario.id]);

  const visibles = (clientes || []).filter((c) => c.razonSocial.toLowerCase().includes(q.toLowerCase()));
  const alternar = (id) => setMarcados((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function guardar() {
    setGuardando(true);
    setError('');
    try {
      await api(`/usuarios/${usuario.id}/clientes`, { metodo: 'PUT', cuerpo: { clienteIds: [...marcados] } });
      alGuardar(marcados.size);
    } catch (e) {
      setError(e.message);
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3 panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="titulo-seccion">Clientes que ve {usuario.nombre}</h2>
        <span className="tecnica text-machine">{marcados.size} asignados</span>
      </div>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <input className="campo" placeholder="Buscar cliente…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!clientes ? <p className="text-sm text-machine">Cargando…</p> : (
        <div className="max-h-72 divide-y overflow-y-auto border-y">
          {visibles.map((c) => (
            <label key={c.id} className="flex items-center gap-2 py-2 text-sm">
              <input type="checkbox" checked={marcados.has(c.id)} onChange={() => alternar(c.id)} />
              {c.razonSocial}
            </label>
          ))}
          {visibles.length === 0 && <p className="py-2 text-sm text-machine">Sin resultados.</p>}
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn-primario btn-sm" disabled={guardando || !clientes} onClick={guardar}>Guardar</button>
        <button className="btn-sec btn-sm" onClick={cerrar}>Cancelar</button>
      </div>
    </div>
  );
}

export default function Usuarios() {
  const [lista, setLista] = useState([]);
  const [f, setF] = useState({ nombre: '', email: '', password: '', rol: 'USUARIO', verDinero: false, accesoClientes: 'ASIGNADOS' });
  const [error, setError] = useState('');
  const [asignando, setAsignando] = useState(null);

  const cargar = () => api('/usuarios').then(setLista);
  useEffect(() => { cargar(); }, []);

  async function crear(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/usuarios', { metodo: 'POST', cuerpo: f });
      setF({ nombre: '', email: '', password: '', rol: 'USUARIO', verDinero: false, accesoClientes: 'ASIGNADOS' });
      cargar();
    } catch (ex) {
      const detalle = ex instanceof ErrorApi ? Object.values(ex.detalles).flat().join(' ') : '';
      setError(`${ex.message}${detalle ? `: ${detalle}` : ''}`);
    }
  }
  async function cambiar(u, cuerpo) {
    setError('');
    try {
      await api(`/usuarios/${u.id}`, { metodo: 'PATCH', cuerpo });
      cargar();
    } catch (ex) {
      setError(ex.message);
    }
  }
  const alternar = (u) => cambiar(u, { activo: !u.activo });
  const alternarDinero = (u) => {
    if (!u.verDinero || confirm(`${u.nombre} dejará de ver honorarios, cobros, deudas y montos. ¿Continuar?`)) cambiar(u, { verDinero: !u.verDinero });
  };

  return (
    <div className="space-y-6">
      <h1 className="titulo-pagina">Usuarios del equipo</h1>
      <form onSubmit={crear} className="grid gap-2 panel sm:grid-cols-5">
        <input className="campo" required placeholder="Nombre" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
        <input className="campo" required type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className="campo" required type="password" minLength={8} placeholder="Contraseña (mín. 8)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <select className="campo" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}>
          <option value="USUARIO">Usuario</option>
          <option value="ADMIN">Administrador</option>
        </select>
        <button className="btn-primario">Crear usuario</button>
        <label className="flex items-start gap-2 text-sm sm:col-span-5">
          <input type="checkbox" className="mt-0.5" checked={f.verDinero || f.rol === 'ADMIN'} disabled={f.rol === 'ADMIN'} onChange={(e) => setF({ ...f, verDinero: e.target.checked })} />
          <span>
            Puede ver honorarios, cobros, deudas y montos
            <span className="block text-xs text-machine">
              {f.rol === 'ADMIN' ? 'Los administradores ven y gestionan todo, incluido el dinero.' : 'Por defecto no ve nada de dinero: solo clientes, tareas, agenda, calendario y documentos.'}
            </span>
          </span>
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm sm:col-span-5">
          Clientes que verá
          <select className="campo !w-auto" value={f.rol === 'ADMIN' ? 'TODOS' : f.accesoClientes} disabled={f.rol === 'ADMIN'} onChange={(e) => setF({ ...f, accesoClientes: e.target.value })}>
            <option value="ASIGNADOS">Solo los clientes que le asigne</option>
            <option value="TODOS">Todos los clientes</option>
          </select>
          <span className="text-xs text-machine">{f.rol === 'ADMIN' ? 'Los administradores ven todos.' : 'Después podés elegir cuáles desde "Asignar" o desde la ficha de cada cliente.'}</span>
        </label>
      </form>
      {asignando && (
        <AsignarClientes
          usuario={asignando}
          cerrar={() => setAsignando(null)}
          alGuardar={() => { setAsignando(null); cargar(); }}
        />
      )}
      {error && <Alerta tipo="error">{error}</Alerta>}
      <div className="overflow-x-auto panel-plano">
        <table className="w-full text-left text-sm">
          <thead className="encabezado-tabla">
            <tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Rol</th><th className="px-3 py-2">Ve el dinero</th><th className="px-3 py-2">Clientes</th><th className="px-3 py-2">Estado</th><th /></tr>
          </thead>
          <tbody className="divide-y">
            {lista.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2">{u.nombre}</td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.rol === 'ADMIN' ? 'Administrador' : 'Usuario'}</td>
                <td className="px-3 py-2">
                  {u.rol === 'ADMIN' ? <span className="text-machine">Sí (administrador)</span> : (
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={u.verDinero} onChange={() => alternarDinero(u)} aria-label={`${u.nombre} puede ver el dinero`} />
                      <span className={u.verDinero ? 'font-medium text-figure' : 'text-machine'}>{u.verDinero ? 'Sí' : 'No'}</span>
                    </label>
                  )}
                </td>
                <td className="px-3 py-2">
                  {u.rol === 'ADMIN' ? <span className="text-machine">Todos</span> : (
                    <div className="flex flex-wrap items-center gap-2">
                      <select className="campo !w-auto" value={u.todosLosClientes ? 'TODOS' : 'ASIGNADOS'} onChange={(e) => cambiar(u, { accesoClientes: e.target.value })} aria-label={`Clientes que ve ${u.nombre}`}>
                        <option value="TODOS">Todos</option>
                        <option value="ASIGNADOS">Solo asignados</option>
                      </select>
                      {!u.todosLosClientes && <button className="enlace" onClick={() => setAsignando(u)}>Asignar clientes</button>}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">{u.activo ? 'Activo' : 'Desactivado'}</td>
                <td className="px-3 py-2 text-right"><button className="btn-sec btn-sm" onClick={() => alternar(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
