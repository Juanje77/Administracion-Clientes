const estilos = {
  ACTIVO: 'bg-green-100 text-green-700',
  INACTIVO: 'bg-slate-200 text-slate-600',
  POTENCIAL: 'bg-amber-100 text-amber-700',
};
const nombres = { ACTIVO: 'Activo', INACTIVO: 'Inactivo', POTENCIAL: 'Potencial' };

export default function Estado({ estado }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${estilos[estado]}`}>{nombres[estado]}</span>;
}
