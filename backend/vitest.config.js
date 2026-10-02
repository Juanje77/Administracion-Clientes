const { defineConfig } = require('vitest/config');
module.exports = defineConfig({
  test: { globals: true, environment: 'node', fileParallelism: false, env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'secreto-de-pruebas-largo-123',
    DATABASE_URL: 'postgresql://app:app@localhost:5432/clientes_test',
  } },
});
