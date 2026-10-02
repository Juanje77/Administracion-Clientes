require('dotenv').config();
const app = require('./app');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error('Falta JWT_SECRET (mínimo 16 caracteres) en el archivo .env');
  process.exit(1);
}
const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`API escuchando en http://localhost:${port}`));
