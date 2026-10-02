import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, NavLink } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import Login from './paginas/Login';
import Clientes from './paginas/Clientes';
import ClienteForm from './paginas/ClienteForm';
import ClienteDetalle from './paginas/ClienteDetalle';
import Usuarios from './paginas/Usuarios';
import Agenda from './paginas/Agenda';
import Cuenta from './paginas/Cuenta';
import Calendario from './paginas/Calendario';
import Importar from './paginas/Importar';
import Honorarios from './paginas/Honorarios';
import Inicio from './paginas/Inicio';
import Avisos from './paginas/Avisos';

function Layout({ children }) {
  const { usuario, logout } = useAuth();
  const [urgentes, setUrgentes] = useState(0);

  // Aviso de pendientes urgentes (vencidos o de hoy): se refresca cada 5 min y tras cada cambio.
  useEffect(() => {
    const cargar = () => api('/alertas').then((a) => setUrgentes(a.urgentes)).catch(() => {});
    cargar();
    const t = setInterval(cargar, 300000);
    window.addEventListener('alertas', cargar);
    return () => { clearInterval(t); window.removeEventListener('alertas', cargar); };
  }, []);
  const enlace = ({ isActive }) =>
    `rounded px-3 py-1.5 text-sm ${isActive ? 'bg-blue-100 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`;
  return (
    <>
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-3">
          <span className="mr-4 font-semibold">Estudio Contable</span>
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/inicio" className={enlace}>Inicio</NavLink>
            <NavLink to="/agenda" className={enlace}>
              Agenda
              {urgentes > 0 && <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs text-white" aria-label={`${urgentes} urgentes`}>{urgentes}</span>}
            </NavLink>
            <NavLink to="/clientes" className={enlace}>Clientes</NavLink>
            <NavLink to="/honorarios" className={enlace}>Honorarios</NavLink>
            <NavLink to="/calendario" className={enlace}>Calendario</NavLink>
            {usuario.rol === 'ADMIN' && <NavLink to="/avisos" className={enlace}>Avisos</NavLink>}
            {usuario.rol === 'ADMIN' && <NavLink to="/usuarios" className={enlace}>Usuarios</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <NavLink to="/cuenta" className="text-slate-500 hover:underline">{usuario.nombre}</NavLink>
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
        <Route path="/" element={<Navigate to="/inicio" replace />} />
        <Route path="/inicio" element={<Inicio />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/cuenta" element={<Cuenta />} />
        <Route path="/calendario" element={<Calendario />} />
        <Route path="/honorarios" element={<Honorarios />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/clientes/nuevo" element={<ClienteForm />} />
        <Route path="/clientes/:id" element={<ClienteDetalle />} />
        <Route path="/clientes/:id/editar" element={<ClienteForm />} />
        {usuario.rol === 'ADMIN' && <Route path="/usuarios" element={<Usuarios />} />}
        {usuario.rol === 'ADMIN' && <Route path="/importar" element={<Importar />} />}
        {usuario.rol === 'ADMIN' && <Route path="/avisos" element={<Avisos />} />}
        <Route path="*" element={<Navigate to="/inicio" replace />} />
      </Routes>
    </Layout>
  );
}
