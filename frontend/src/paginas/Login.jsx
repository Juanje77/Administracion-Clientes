import { useState } from 'react';
import { useAuth } from '../auth';
import Alerta from '../componentes/Alerta';
import Marca from '../componentes/Marca';

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
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <Marca tamano={28} className="mb-8" />
      <h1 className="tecnica text-[44px] leading-none tracking-[-0.03em] sm:text-[64px]">Estudio<br />Contable</h1>
      <p className="mt-4 text-[16px] text-machine">Administración de clientes</p>
      <form onSubmit={enviar} className="mt-12 space-y-7">
        <div>
          <label className="etiqueta-label" htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="username" className="campo" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="etiqueta-label" htmlFor="password">Contraseña</label>
          <input id="password" type="password" required autoComplete="current-password" className="campo" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <Alerta tipo="error">{error}</Alerta>}
        <button className="btn-primario w-full sm:w-auto" disabled={cargando}>{cargando ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </div>
  );
}
