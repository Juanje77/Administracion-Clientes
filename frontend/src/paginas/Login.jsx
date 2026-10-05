import { useState } from 'react';
import { useAuth } from '../auth';
import Alerta from '../componentes/Alerta';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  async function enviar(e) {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-2">
      {/* Panel de marca (en el celular, una franja arriba) */}
      <div className="relative flex items-center justify-center bg-figure px-8 py-5 lg:py-12">
        <img src="/logo-1.png" alt="JC" className="w-16 lg:w-[min(380px,70%)]" />
        <p className="absolute bottom-8 left-12 hidden text-[15px] uppercase tracking-[.14em] text-suave lg:block">Administración de clientes</p>
      </div>
      <div className="flex items-center justify-center px-6 py-10 lg:px-12">
        <form onSubmit={enviar} className="flex w-full max-w-[340px] flex-col gap-5">
          <img src="/logo-3.png" alt="Juan Costantini" className="mx-auto -mb-4 w-[200px]" />
          <h1 className="titulo-pagina !text-[40px]">Ingresar</h1>
          <div>
            <label className="etiqueta-label" htmlFor="email">Correo</label>
            <input id="email" type="email" required autoComplete="username" className="campo" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="etiqueta-label" htmlFor="password">Contraseña</label>
            <input id="password" type="password" required autoComplete="current-password" className="campo" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <Alerta tipo="error">{error}</Alerta>}
          <button className="btn-primario h-12 w-full" disabled={cargando}>{cargando ? 'Ingresando…' : 'Entrar'}</button>
        </form>
      </div>
    </div>
  );
}
