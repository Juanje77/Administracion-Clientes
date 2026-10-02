const { defineConfig } = require('vitest/config');
// Los tests se ejecutan con el emulador de Firestore (npm test lo levanta solo).
module.exports = defineConfig({
  test: { globals: true, environment: 'node', fileParallelism: false,
    env: { NODE_ENV: 'test', JWT_SECRET: 'secreto-de-pruebas-largo-123', FIREBASE_STORAGE_BUCKET: 'demo-clientes.appspot.com' } },
});
