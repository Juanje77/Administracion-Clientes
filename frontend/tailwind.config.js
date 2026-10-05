// Sistema visual "Juan Costantini": azul marino de marca, fondo gris muy claro, esquinas rectas, bordes de 1 px y sin sombras.
// Títulos en Barlow Condensed (mayúsculas), cuerpo en Barlow. Los nombres de los colores se conservan de la versión anterior
// (figure = color principal de la marca) para no tocar cada pantalla.
const sistema = ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'];

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',
      black: '#000000',
      figure: '#0c284b',   // azul marino de marca: botones, títulos, barra lateral
      hover: '#1d4373',    // hover del azul marino
      tinta: '#14202e',    // texto del cuerpo
      machine: '#5b6d84',  // texto secundario
      regla: '#cfd6e0',    // bordes de 1 px
      campo: '#b9c3d1',    // borde de los campos
      fondo: '#f4f5f7',    // fondo de la aplicación
      linea: '#e6eaf0',    // separadores suaves dentro de listas y tablas
      lateral: '#26446d',  // borde dentro de la barra lateral
      suave: '#c9d4e3',    // texto claro sobre azul marino
      ok: '#2f6b4f',       // al día / pagada
      pend: '#8a6212',     // pendiente
      venc: '#a33a2f',     // vencido
    },
    fontFamily: {
      sans: ['Barlow', ...sistema],
      tecnica: ['"Barlow Condensed"', ...sistema],
    },
    extend: {
      borderColor: { DEFAULT: '#cfd6e0' },
      borderRadius: { panel: '0', boton: '0' },
      letterSpacing: { nav: '0.04em', cuerpo: '0' },
    },
  },
  plugins: [],
};
