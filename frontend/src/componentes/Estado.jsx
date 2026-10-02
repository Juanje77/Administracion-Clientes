const estilos = {
  ACTIVO: 'insignia-linea',
  INACTIVO: 'insignia-gris',
  POTENCIAL: 'insignia-gris',
};
const nombres = { ACTIVO: 'Activo', INACTIVO: 'Inactivo', POTENCIAL: 'Potencial' };

export default function Estado({ estado }) {
  return <span className={estilos[estado]}>{nombres[estado]}</span>;
}
