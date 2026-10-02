// Crea el primer usuario administrador: npm run seed -- email password "Nombre"
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const [email, password, nombre = 'Administrador'] = process.argv.slice(2);
  if (!email || !password || password.length < 8) {
    console.error('Uso: npm run seed -- email password(mín. 8) "Nombre"');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.usuario.upsert({
    where: { email: email.toLowerCase() },
    update: { passwordHash, rol: 'ADMIN', activo: true },
    create: { email: email.toLowerCase(), nombre, passwordHash, rol: 'ADMIN' },
  });
  console.log(`Administrador listo: ${email}`);
  await prisma.$disconnect();
})();
