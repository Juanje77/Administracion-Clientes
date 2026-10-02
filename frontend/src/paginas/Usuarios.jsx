import { useEffect, useState } from 'react';
import { api, ErrorApi } from '../api';

export default function Usuarios() {
  const [lista, setLista] = useState([]);
  const [f, setF] = useState({ nombre: '', email: '', password: '', rol: 'USUARIO' });
  const [error, setError] = useState('');

  const cargar = () => api('/usuarios').then(setLista);
  useEffect(() => { cargar(); }, []);

  async function crear(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/usuarios', { metodo: 'POST', cuerpo: f });
      setF({ nombre: '', email: '', password: '', rol: 'USUARIO' });
      cargar();
    } catch (ex) {
      const detalle = ex instanceof ErrorApi ? Object.values(ex.detalles).flat().join(' ') : '';
      setError(`${ex.message}${detalle ? `: ${detalle}` : ''}`);
    }
  }
  async function alternar(u) {
    try {
      await api(`/usuarios/${u.id}`, { metodo: 'PATCH', cuerpo: { activo: !u.activo } });
      cargar();
    } catch (ex) {
      setError(ex.message);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Usuarios del equipo</h1>
      <form onSubmit={crear} className="grid gap-2 rounded-lg border bg-white p-4 sm:grid-cols-5">
        <input className="campo" required placeholder="Nombre" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
        <input className="campo" required type="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <input className="campo" required type="password" minLength={8} placeholder="Contraseña (mín. 8)" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <select className="campo" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}>
          <option value="USUARIO">Usuario</option>
          <option value="ADMIN">Administrador</option>
        </select>
        <button className="btn-primario">Crear usuario</button>
      </form>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="px-3 py-2">Nombre</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Rol</th><th className="px-3 py-2">Estado</th><th /></tr>
          </thead>
          <tbody className="divide-y">
            {lista.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2">{u.nombre}</td>
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.rol === 'ADMIN' ? 'Administrador' : 'Usuario'}</td>
                <td className="px-3 py-2">{u.activo ? 'Activo' : 'Desactivado'}</td>
                <td className="px-3 py-2 text-right"><button className="btn-sec" onClick={() => alternar(u)}>{u.activo ? 'Desactivar' : 'Activar'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
