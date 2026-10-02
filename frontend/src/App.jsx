import { Navigate, Route, Routes, NavLink } from 'react-router-dom';
import { useAuth } from './auth';
import Login from './paginas/Login';
import Clientes from './paginas/Clientes';
import ClienteForm from './paginas/ClienteForm';
import ClienteDetalle from './paginas/ClienteDetalle';
import Usuarios from './paginas/Usuarios';

function Layout({ children }) {
  const { usuario, logout } = useAuth();
  const enlace = ({ isActive }) =>
    `rounded px-3 py-1.5 text-sm ${isActive ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`;
  return (
    <>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <span className="mr-4 font-semibold">Estudio Contable</span>
          <nav className="flex gap-1">
            <NavLink to="/clientes" className={enlace}>Clientes</NavLink>
            {usuario.rol === 'ADMIN' && <NavLink to="/usuarios" className={enlace}>Usuarios</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-500">{usuario.nombre}</span>
            <button className="btn-sec" onClick={logout}>Salir</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}

export default function App() {
  const { usuario } = useAuth();
  if (usuario === undefined) return <p className="p-6 text-slate-500">Cargando…</p>;
  if (!usuario) return <Login />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/clientes" replace />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/clientes/nuevo" element={<ClienteForm />} />
        <Route path="/clientes/:id" element={<ClienteDetalle />} />
        <Route path="/clientes/:id/editar" element={<ClienteForm />} />
        {usuario.rol === 'ADMIN' && <Route path="/usuarios" element={<Usuarios />} />}
        <Route path="*" element={<Navigate to="/clientes" replace />} />
      </Routes>
    </Layout>
  );
}
