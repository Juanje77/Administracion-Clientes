import { useState } from 'react';
import { escala, mesCorto, pesos, pesosCortos } from '../formato';
import { nombrePeriodo } from '../fechas';

// Columnas de "cobrado por mes". Una sola serie (el título la nombra, no hace falta leyenda).
// Columnas negras de borde recto, reglas de 1 px y etiquetas en gris técnico; el mes elegido va en negrita.
// Hay tooltip al pasar el cursor/enfocar y una vista de tabla para quien no puede leer el gráfico.
const COLOR = '#0c284b'; // azul marino de marca: una sola serie

export default function GraficoMeses({ serie, seleccionado }) {
  const [tabla, setTabla] = useState(false);
  const [activo, setActivo] = useState(null);
  const { tope, marcas } = escala(Math.max(...serie.map((s) => s.cobrado)));
  const total = serie.reduce((t, s) => t + s.cobrado, 0);

  return (
    <section className="panel">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="titulo-seccion">Cobrado por mes <span className="text-[14px] tracking-normal text-machine">· últimos {serie.length} meses</span></h2>
        <button className="enlace text-[14px]" onClick={() => setTabla(!tabla)}>{tabla ? 'Ver gráfico' : 'Ver como tabla'}</button>
      </div>

      {tabla ? (
        <table className="w-full text-left text-sm">
          <thead className="encabezado-tabla"><tr><th className="py-1">Mes</th><th className="py-1 text-right">Facturado</th><th className="py-1 text-right">Cobrado</th></tr></thead>
          <tbody className="divide-y">
            {serie.map((s) => (
              <tr key={s.periodo}><td className="py-1">{nombrePeriodo(s.periodo)}</td><td className="py-1 text-right tabular-nums">{pesos(s.facturado)}</td><td className="py-1 text-right tabular-nums">{pesos(s.cobrado)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : total === 0 ? (
        <p className="py-10 text-center text-sm text-machine">Todavía no hay cobros registrados en estos meses.</p>
      ) : (
        <div role="group" aria-label="Cobrado por mes" className="mt-16 flex">
          {/* eje vertical: marcas redondas, texto en gris suave */}
          <div className="relative mr-2 h-48 w-14 shrink-0 text-right text-xs tabular-nums text-machine" aria-hidden="true">
            {marcas.map((m) => (
              <span key={m} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${(m / tope) * 100}%` }}>{m === 0 ? '0' : pesosCortos(m)}</span>
            ))}
          </div>
          <div className="relative flex-1">
            <div className="relative h-48">
              {marcas.map((m) => (
                <div key={m} className="absolute inset-x-0 border-t" style={{ bottom: `${(m / tope) * 100}%` }} aria-hidden="true" />
              ))}
              <div className="absolute inset-0 flex items-end">
                {serie.map((s) => {
                  const alto = (s.cobrado / tope) * 100;
                  const esActivo = activo === s.periodo;
                  return (
                    <button
                      key={s.periodo} type="button"
                      className="group relative flex h-full flex-1 flex-col items-center justify-end outline-none"
                      aria-label={`${nombrePeriodo(s.periodo)}: cobrado ${pesos(s.cobrado)}, facturado ${pesos(s.facturado)}`}
                      onMouseEnter={() => setActivo(s.periodo)} onMouseLeave={() => setActivo(null)} onFocus={() => setActivo(s.periodo)} onBlur={() => setActivo(null)}
                    >
                      {s.cobrado > 0 && <span className="mb-1 whitespace-nowrap text-[11px] tabular-nums text-figure sm:text-xs">{pesosCortos(s.cobrado)}</span>}
                      <span
                        className="block w-full max-w-6 transition-opacity"
                        style={{ height: `${alto}%`, minHeight: s.cobrado > 0 ? 2 : 0, background: COLOR, opacity: activo && !esActivo ? 0.35 : 1 }}
                      />
                      {esActivo && (
                        <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap border border-figure bg-white px-3 py-2 text-xs">
                          <strong className="block text-figure">{nombrePeriodo(s.periodo)}</strong>
                          <span className="block text-machine">Cobrado: {pesos(s.cobrado)}</span>
                          <span className="block text-machine">Facturado: {pesos(s.facturado)}</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-1 flex">
              {serie.map((s) => (
                <span key={s.periodo} className={`flex-1 text-center text-xs ${s.periodo === seleccionado ? 'font-medium text-figure' : 'text-machine'}`}>{mesCorto(s.periodo)}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
