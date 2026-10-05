import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, NavLink, useLocation } from 'react-router-dom';
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
  const [abierto, setAbierto] = useState(false); // menú en pantallas chicas
  const { pathname } = useLocation();

  // Aviso de pendientes urgentes (vencidos o de hoy): se refresca cada 5 min y tras cada cambio.
  useEffect(() => {
    const cargar = () => api('/alertas').then((a) => setUrgentes(a.urgentes)).catch(() => {});
    cargar();
    const t = setInterval(cargar, 300000);
    window.addEventListener('alertas', cargar);
    return () => { clearInterval(t); window.removeEventListener('alertas', cargar); };
  }, []);
  useEffect(() => { setAbierto(false); }, [pathname]);

  const enlace = ({ isActive }) =>
    `flex items-center justify-between border-l-2 px-3 py-3 text-[16px] leading-none text-white transition-colors lg:py-2.5 ${isActive ? 'border-white bg-hover' : 'border-transparent hover:bg-hover/60'}`;
  const menu = (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Secciones">
      <NavLink to="/inicio" className={enlace}>Inicio</NavLink>
      <NavLink to="/agenda" className={enlace}>
        Agenda
        {urgentes > 0 && <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center bg-white px-1.5 text-[12px] font-semibold leading-none text-figure" aria-label={`${urgentes} urgentes`}>{urgentes}</span>}
      </NavLink>
      <NavLink to="/clientes" className={enlace}>Clientes</NavLink>
      {usuario.verDinero && <NavLink to="/honorarios" className={enlace}>Honorarios</NavLink>}
      <NavLink to="/calendario" className={enlace}>Calendario</NavLink>
      {usuario.rol === 'ADMIN' && <NavLink to="/avisos" className={enlace}>Avisos</NavLink>}
      {usuario.rol === 'ADMIN' && <NavLink to="/usuarios" className={enlace}>Usuarios</NavLink>}
    </nav>
  );
  const pie = (
    <div className="mt-auto flex flex-col gap-2 border-t border-lateral p-5 text-[14px] text-suave">
      <NavLink to="/cuenta" className="truncate text-suave underline-offset-4 hover:text-white hover:underline">{usuario.nombre}</NavLink>
      <button className="border border-[#4a6a96] p-2 text-white transition-colors hover:bg-hover" onClick={logout}>Salir</button>
    </div>
  );
  const marca = (
    <NavLink to="/inicio" className="flex items-center gap-3" aria-label="Juan Costantini, ir al inicio">
      <Marca tamano={44} />
      <span className="tecnica text-[20px] leading-none text-white">Juan<br />Costantini</span>
    </NavLink>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Escritorio: barra lateral fija */}
      <aside className="sticky top-0 hidden h-screen w-[232px] flex-none flex-col bg-figure text-white lg:flex">
        <div className="px-5 pb-6 pt-5">{marca}</div>
        {menu}
        {pie}
      </aside>

      {/* Celular: barra superior con menú desplegable */}
      <div className="bg-figure text-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          {marca}
          <button className="border border-[#4a6a96] px-3 py-2 text-[14px] uppercase tracking-[.06em]" aria-expanded={abierto} aria-controls="menu-movil" onClick={() => setAbierto(!abierto)}>
            {abierto ? 'Cerrar' : 'Menú'}
            {!abierto && urgentes > 0 && <span className="ml-2 bg-white px-1.5 text-[12px] font-semibold text-figure">{urgentes}</span>}
          </button>
        </div>
        {abierto && <div id="menu-movil" className="flex flex-col pb-2">{menu}{pie}</div>}
      </div>

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
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
