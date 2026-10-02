const estilos = {
  VENCIDA: 'insignia-negra',
  HOY: 'insignia-negra',
  PROXIMA: 'insignia-linea',
  FUTURA: 'insignia-gris',
  CERRADA: 'insignia-gris',
};
const nombres = { VENCIDA: 'Vencida', HOY: 'Hoy', PROXIMA: 'Próxima', FUTURA: 'Pendiente', CERRADA: 'Cerrada' };

export default function Situacion({ valor }) {
  return <span className={estilos[valor]}>{nombres[valor]}</span>;
}
