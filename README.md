# Administración de Clientes (Estudio Contable)

Sistema web para administrar clientes. **Etapa 1 (MVP)**: login con roles, clientes
(con datos fiscales y validación de CUIT), búsqueda/filtros/orden, etiquetas e
historial de interacciones.

- **Backend:** Node.js + Express + Prisma + PostgreSQL (`backend/`)
- **Frontend:** React + Vite + Tailwind (`frontend/`)

## Requisitos
Node.js 20+ y PostgreSQL 14+.

## Instalación paso a paso

1. **Crear la base de datos** (en `psql`):
   ```sql
   CREATE USER app WITH PASSWORD 'una-clave-segura';
   CREATE DATABASE clientes OWNER app;
   ```
   > Para que el orden alfabético respete tildes (é, ñ), la base debe usar una
   > collation `es_*` o `en_US.UTF-8`. Los hostings administrados ya la traen.
2. **Configurar el backend:**
   ```bash
   cd backend
   cp .env.example .env     # editar DATABASE_URL y JWT_SECRET
   npm install
   npx prisma migrate deploy
   npm run seed -- tu@email.com "TuClaveSegura" "Tu Nombre"   # primer administrador
   ```
3. **Instalar el frontend:** `cd ../frontend && npm install`

## Ejecutar en desarrollo
Dos terminales:
```bash
cd backend  && npm run dev      # API en http://localhost:3001
cd frontend && npm run dev      # App en http://localhost:5173
```

## Producción
```bash
cd frontend && npm run build    # genera frontend/dist
cd ../backend && NODE_ENV=production npm start
```
El servidor entrega la API y el frontend compilado en un mismo puerto.

## Tests
```bash
cd backend && npm test          # usa la base "clientes_test" (ver vitest.config.js)
```
Crear la base de pruebas y migrarla:
`DATABASE_URL=postgresql://app:app@localhost:5432/clientes_test npx prisma migrate deploy`

## Roles
- **Administrador:** gestiona usuarios y puede eliminar clientes definitivamente.
- **Usuario:** opera clientes e interacciones. "Eliminar" archiva (estado Inactivo).

## Hoja de ruta
2. Tareas, vencimientos impositivos y alertas · 3. Honorarios y documentos ·
4. Dashboard, importar/exportar, backups · 5. Despliegue online.
