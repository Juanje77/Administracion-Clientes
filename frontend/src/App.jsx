import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, NavLink } from 'react-router-dom';
import { api } from './api';
import Marca from './componentes/Marca';
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
  // Navegación técnica: mayúsculas de 14 px con +0.28 px de tracking; la sección activa va subrayada
  const enlace = ({ isActive }) =>
    `tecnica inline-flex items-center border-b-2 py-2 text-[14px] leading-none transition-colors ${isActive ? 'border-figure text-figure' : 'border-transparent text-machine hover:text-figure'}`;
  return (
    <>
      <header className="border-b border-regla bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-8 sm:py-4">
          <NavLink to="/inicio" className="tecnica mr-1 inline-flex items-center gap-2 text-[14px] leading-none text-figure" aria-label="Estudio Contable, ir al inicio">
            <Marca /> Estudio Contable
          </NavLink>
          <nav className="flex flex-wrap gap-x-6 gap-y-1">
            <NavLink to="/inicio" className={enlace}>Inicio</NavLink>
            <NavLink to="/agenda" className={enlace}>
              Agenda
              {urgentes > 0 && <span className="ml-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-figure px-1.5 text-[11px] leading-none text-white" aria-label={`${urgentes} urgentes`}>{urgentes}</span>}
            </NavLink>
            <NavLink to="/clientes" className={enlace}>Clientes</NavLink>
            {usuario.verDinero && <NavLink to="/honorarios" className={enlace}>Honorarios</NavLink>}
            <NavLink to="/calendario" className={enlace}>Calendario</NavLink>
            {usuario.rol === 'ADMIN' && <NavLink to="/avisos" className={enlace}>Avisos</NavLink>}
            {usuario.rol === 'ADMIN' && <NavLink to="/usuarios" className={enlace}>Usuarios</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-4 text-[14px]">
            <NavLink to="/cuenta" className="enlace-tenue">{usuario.nombre}</NavLink>
            <button className="btn-sec btn-sm" onClick={logout}>Salir</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8 sm:py-10">{children}</main>
    </>
  );
}

export default function App() {
  const { usuario } = useAuth();
  if (usuario === undefined) return <p className="p-6 text-machine">Cargando…</p>;
  if (!usuario) return <Login />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/inicio" replace />} />
        <Route path="/inicio" element={<Inicio />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/cuenta" element={<Cuenta />} />
        <Route path="/calendario" element={<Calendario />} />
        {usuario.verDinero && <Route path="/honorarios" element={<Honorarios />} />}
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
