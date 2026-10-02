import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api';
import Alerta from '../componentes/Alerta';

export default function Usuarios() {
  const [lista, setLista] = useState([]);
  const [f, setF] = useState({ nombre: '', email: '', password: '', rol: 'USUARIO', verDinero: false });
  const [error, setError] = useState('');

  const cargar = () => api('/usuarios').then(setLista);
  useEffect(() => { cargar(); }, []);

  async function crear(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/usuarios', { metodo: 'POST', cuerpo: f });
      setF({ nombre: '', email: '', password: '', rol: 'USUARIO', verDinero: false });
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
      </form>
      {error && <Alerta tipo="error">{error}</Alerta>}
      <div className="overflow-x-auto panel-plano">
        <table className="w-full text-left text-sm">
          <thead className="encabezado-tabla">
            <tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Rol</th><th className="px-3 py-2">Ve el dinero</th><th className="px-3 py-2">Estado</th><th /></tr>
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
