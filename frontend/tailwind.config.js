// Sistema visual basado en DESIGN_1.md (referencia "FigureAI"): lienzo blanco, texto negro exacto,
// grises técnicos y nada más. Se limita la paleta a propósito: sin acentos saturados, sin degradados.
const sistema = ['ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'];

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',   // Lab White: lienzo y superficies
      black: '#000000',   // Absolute Black
      figure: '#0c0c0c',  // Figure Black: texto principal, botones, marcas
      machine: '#6d6d6d', // Machine Gray: medidas, etiquetas y texto secundario
      regla: '#cecece',   // Calibration Gray: reglas de 1 px
    },
    fontFamily: {
      sans: ['Inter', ...sistema],                       // sustituto de Neue Haas Grotesk
      tecnica: ['"Space Grotesk"', ...sistema],          // sustituto de PP Neue Machina
    },
    extend: {
      borderColor: { DEFAULT: '#cecece' },
      borderRadius: { panel: '12px', boton: '24px' },
      letterSpacing: { nav: '0.28px', cuerpo: '-0.16px' },
    },
  },
  plugins: [],
};
