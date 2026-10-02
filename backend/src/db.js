// Cliente único de Prisma (ORM): todas las consultas van parametrizadas,
// lo que protege contra inyección SQL.
const { PrismaClient } = require('@prisma/client');
module.exports = new PrismaClient();
