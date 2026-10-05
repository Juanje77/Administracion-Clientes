// Mensaje de estado en blanco y negro: se distingue por su símbolo y su texto, no por el color.
const SIMBOLO = { error: '✕', ok: '✓', info: 'i', aviso: '!' };

export default function Alerta({ tipo = 'error', children, className = '' }) {
  return (
    <p role={tipo === 'ok' ? 'status' : 'alert'} className={`flex items-start gap-2.5 text-[14px] leading-snug ${className}`}>
      <span aria-hidden="true" className="tecnica mt-px inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-none border border-figure text-[11px] normal-case">{SIMBOLO[tipo]}</span>
      <span className={tipo === 'error' ? 'font-medium' : ''}>{children}</span>
    </p>
  );
}
