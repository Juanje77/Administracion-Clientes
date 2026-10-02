import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import Alerta from './Alerta';

const CATEGORIAS = { CONTRATO: 'Contrato', PRESUPUESTO: 'Presupuesto', FACTURA: 'Factura', CONSTANCIA: 'Constancia', BALANCE: 'Balance', OTRO: 'Otro' };
const MAX_MB = 4;
const SE_VE = /\.(pdf|png|jpe?g|webp)$/i;

const tamano = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fecha = (d) => new Date(d).toLocaleDateString('es-AR');

export default function DocumentosCliente({ clienteId }) {
  const { usuario } = useAuth();
  const [docs, setDocs] = useState([]);
  const [categoria, setCategoria] = useState('CONTRATO');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');

  const cargar = () => api(`/documentos?clienteId=${clienteId}`).then(setDocs).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, [clienteId]);

  async function subir(e) {
    const archivo = e.target.files[0];
    e.target.value = '';
    if (!archivo) return;
    setError('');
    if (archivo.size > MAX_MB * 1024 * 1024) return setError(`El archivo pesa ${tamano(archivo.size)}; el máximo es ${MAX_MB} MB. Prueba comprimirlo o escanearlo con menor calidad.`);
    setSubiendo(true);
    try {
      await api(`/documentos?clienteId=${clienteId}&categoria=${categoria}&nombre=${encodeURIComponent(archivo.name)}`, { metodo: 'POST', cuerpo: archivo });
      cargar();
    } catch (ex) {
      setError(ex.message);
    } finally {
      setSubiendo(false);
    }
  }
  async function borrar(d) {
    if (!confirm(`¿Borrar "${d.nombre}"? No se puede deshacer.`)) return;
    try { await api(`/documentos/${d.id}`, { metodo: 'DELETE' }); cargar(); } catch (ex) { setError(ex.message); }
  }

  return (
    <section className="panel">
      <h2 className="titulo-seccion mb-3">Documentos</h2>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="campo w-40" value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Tipo de documento">
          {Object.entries(CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className={`btn-primario cursor-pointer ${subiendo ? 'opacity-50' : ''}`}>
          {subiendo ? 'Subiendo…' : '+ Subir archivo'}
          <input type="file" className="sr-only" disabled={subiendo} onChange={subir}
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.doc,.docx,.xls,.xlsx,.csv,.txt,image/*" />
        </label>
        <span className="text-xs text-machine">PDF, imágenes, Word, Excel · máx. {MAX_MB} MB</span>
      </div>
      {error && <Alerta tipo="error">{error}</Alerta>}

      <ul className="divide-y">
        {docs.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium">{d.nombre}</p>
              <p className="text-xs text-machine">{CATEGORIAS[d.categoria]} · {tamano(d.tamano)} · {fecha(d.creadoEn)} · {d.subidoPorNombre}</p>
            </div>
            {SE_VE.test(d.nombre) && <a className="btn-sec" href={`/api/documentos/${d.id}/descargar?ver=1`} target="_blank" rel="noreferrer">Ver</a>}
            <a className="btn-sec" href={`/api/documentos/${d.id}/descargar`}>Descargar</a>
            {(d.subidoPor === usuario.id || usuario.rol === 'ADMIN') && <button className="text-xs enlace-tenue" onClick={() => borrar(d)}>Borrar</button>}
          </li>
        ))}
        {docs.length === 0 && <li className="py-4 text-center text-sm text-machine">Sin documentos.</li>}
      </ul>
    </section>
  );
}
