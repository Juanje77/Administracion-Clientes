// Crea (o restablece) el administrador: npm run seed -- email password "Nombre"
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db } = require('../src/db');

(async () => {
  const [email, password, nombre = 'Administrador'] = process.argv.slice(2);
  if (!email || !password || password.length < 8) {
    console.error('Uso: npm run seed -- email password(mín. 8) "Nombre"');
    process.exit(1);
  }
  const mail = email.toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  const existente = await db.collection('usuarios').where('email', '==', mail).limit(1).get();
  if (existente.empty) {
    await db.collection('usuarios').add({ nombre, email: mail, passwordHash, rol: 'ADMIN', activo: true, creadoEn: new Date() });
  } else {
    await existente.docs[0].ref.update({ passwordHash, rol: 'ADMIN', activo: true });
  }
  console.log(`Administrador listo: ${mail}`);
  process.exit(0);
})();
