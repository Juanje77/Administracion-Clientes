import { Link } from 'react-router-dom';

// Cifra de la "regla técnica": etiqueta arriba, valor en la cara técnica y una regla de 1 px como separador.
export default function Dato({ titulo, valor, detalle, destacado = false, a }) {
  const cuerpo = (
    <div className="h-full border-t border-regla pb-6 pt-4 transition-colors group-hover:border-figure">
      <p className="text-[14px] text-machine">{titulo}</p>
      <p className={`mt-2 whitespace-nowrap font-tecnica text-[26px] font-normal leading-[1.1] sm:text-[32px] ${destacado ? 'text-figure' : 'text-machine'}`}>{valor}</p>
      {detalle && <p className="mt-1 text-[13px] text-machine">{detalle}</p>}
    </div>
  );
  return a ? <Link to={a} className="group block">{cuerpo}</Link> : cuerpo;
}
