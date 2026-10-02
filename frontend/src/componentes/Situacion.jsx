const estilos = {
  VENCIDA: 'bg-red-100 text-red-700',
  HOY: 'bg-orange-100 text-orange-700',
  PROXIMA: 'bg-amber-100 text-amber-700',
  FUTURA: 'bg-slate-100 text-slate-600',
  CERRADA: 'bg-green-100 text-green-700',
};
const nombres = { VENCIDA: 'Vencida', HOY: 'Hoy', PROXIMA: 'Próxima', FUTURA: 'Pendiente', CERRADA: 'Cerrada' };

export default function Situacion({ valor }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${estilos[valor]}`}>{nombres[valor]}</span>;
}
