import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

export default function Cuenta() {
  const { usuario, actualizarUsuario } = useAuth();
  const [prefMsg, setPrefMsg] = useState('');
  const [avisos, setAvisos] = useState(usuario.avisos !== false);
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
  async function cambiarAvisos(e) {
    const valor = e.target.checked;
    setPrefMsg('');
    setAvisos(valor); // se refleja al instante; si falla, se revierte
    try { actualizarUsuario(await api('/auth/preferencias', { metodo: 'PATCH', cuerpo: { avisos: valor } })); }
    catch (ex) { setAvisos(!valor); setPrefMsg(ex.message); }
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
      <section className="space-y-2 rounded-lg border bg-white p-4">
        <h2 className="font-semibold">Avisos por email</h2>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={avisos} onChange={cambiarAvisos} />
          <span>Recibir cada mañana (de lunes a viernes) un resumen con mis tareas, los vencimientos y, si soy administrador, los deudores. Solo se envía si hay algo pendiente.</span>
        </label>
        {prefMsg && <p role="alert" className="text-sm text-red-600">{prefMsg}</p>}
      </section>
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
