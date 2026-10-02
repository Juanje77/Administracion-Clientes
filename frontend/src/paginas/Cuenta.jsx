import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

export default function Cuenta() {
  const { usuario } = useAuth();
  const [f, setF] = useState({ actual: '', nueva: '', repetir: '' });
  const [msg, setMsg] = useState(null);

  async function cambiar(e) {
    e.preventDefault();
    setMsg(null);
    if (f.nueva !== f.repetir) return setMsg({ ok: false, texto: 'Las contraseñas nuevas no coinciden' });
    try {
      await api('/auth/password', { metodo: 'POST', cuerpo: { actual: f.actual, nueva: f.nueva } });
      setF({ actual: '', nueva: '', repetir: '' });
      setMsg({ ok: true, texto: 'Contraseña actualizada' });
    } catch (ex) {
      setMsg({ ok: false, texto: Object.values(ex.detalles || {}).flat()[0] || ex.message });
    }
  }
  const campo = (k, etiqueta) => (
    <div>
      <label className="etiqueta-label" htmlFor={k}>{etiqueta}</label>
      <input id={k} type="password" required className="campo" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </div>
  );

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Mi cuenta</h1>
      <p className="text-sm text-slate-600">{usuario.nombre} · {usuario.email}</p>
      <form onSubmit={cambiar} className="space-y-3 rounded-lg border bg-white p-4">
        <h2 className="font-semibold">Cambiar contraseña</h2>
        {campo('actual', 'Contraseña actual')}
        {campo('nueva', 'Nueva contraseña (mín. 8 caracteres)')}
        {campo('repetir', 'Repetir nueva contraseña')}
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.texto}</p>}
        <button className="btn-primario">Guardar</button>
      </form>
    </div>
  );
}
