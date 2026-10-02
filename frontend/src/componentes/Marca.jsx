// Marca escalonada del estudio (tres barras), en negro sobre blanco.
export default function Marca({ tamano = 20, className = '' }) {
  return (
    <svg width={tamano} height={tamano} viewBox="8 8 16 16" aria-hidden="true" className={className} fill="currentColor">
      <path d="M9 10h14v3H9zM9 15h10v3H9zM9 20h14v3H9z" />
    </svg>
  );
}
