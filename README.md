# Administración de Clientes (Estudio Contable)

Sistema web para administrar clientes. **Etapa 1 (MVP)**: login con roles, clientes
(con datos fiscales y validación de CUIT), búsqueda/filtros/orden, etiquetas e
historial de interacciones.

- **Backend:** Node.js + Express + **Firebase Firestore** (`backend/`)
- **Frontend:** React + Vite + Tailwind (`frontend/`)

## Requisitos
Node.js 20+, una cuenta de Google (Firebase) y, solo para desarrollar/probar, Java 11+ (lo usa el emulador de Firestore).

## Instalación paso a paso

1. **Crear el proyecto Firebase:** en https://console.firebase.google.com → *Agregar proyecto*.
   Luego *Compilación → Firestore Database → Crear base de datos* (modo producción, región cercana).
2. **Bloquear el acceso directo a la base:** en *Firestore → Reglas* pega el contenido de
   `firestore.rules` y publica. Solo el servidor accede a los datos.
3. **Cuenta de servicio:** *Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada*.
   Guarda el archivo como `backend/cuenta-de-servicio.json` (ya está ignorado por git; **no lo compartas**).
4. **Configurar el backend:**
   ```bash
   cd backend
   cp .env.example .env     # editar FIREBASE_SERVICE_ACCOUNT y JWT_SECRET
   npm install
   npm run seed -- tu@email.com "TuClaveSegura" "Tu Nombre"   # primer administrador
   ```
5. **Instalar el frontend:** `cd ../frontend && npm install`

## Ejecutar en desarrollo
Dos terminales:
```bash
cd backend  && npm run dev      # API en http://localhost:3001 (usa tu Firestore real)
cd frontend && npm run dev      # App en http://localhost:5173
```
Para desarrollar **sin tocar datos reales**, usa el emulador local:
`npm run dev:emu` (en `backend/`) y crea el admin con
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed -- ...`.

## Producción
```bash
cd frontend && npm run build    # genera frontend/dist
cd ../backend && NODE_ENV=production npm start
```
El servidor entrega la API y el frontend compilado en un mismo puerto.

## Tests
```bash
cd backend && npm test          # levanta el emulador de Firestore automáticamente
```

## Modelo de datos (Firestore)
- `usuarios/{id}`: nombre, email, passwordHash, rol, activo
- `clientes/{id}`: datos del cliente + `etiquetas` (lista de textos)
  - `interacciones/{id}` (subcolección): tipo, fecha, detalle, autor
- `cuits/{11 dígitos}`: reserva que garantiza un CUIT único
- `tareas/{id}`: clienteId, título, `vence` (AAAA-MM-DD), asignadoA, hecha
- `vencimientos/{clienteId_impuesto_período}`: impuesto, período, `vence`, estado (PENDIENTE/PRESENTADO). El ID evita duplicados.
- `calendarios/{AAAA-MM}`: filas del calendario mensual con la fecha para cada terminación de CUIT (0–9)

Firestore no busca texto parcial, así que el servidor guarda la lista de clientes en memoria
(se refresca al escribir y cada 60 s) y filtra/ordena ahí. Es adecuado para hasta unos pocos
miles de clientes y evita gastar lecturas.

## Roles
- **Administrador:** gestiona usuarios y puede eliminar clientes definitivamente.
- **Usuario:** opera clientes e interacciones. "Eliminar" archiva (estado Inactivo).

## Agenda, tareas y vencimientos (Etapa 2)
- **Agenda:** pendientes vencidos, de hoy y de los próximos 7 días; el menú muestra un aviso rojo con la cantidad de urgentes.
- **Tareas:** se crean dentro de cada cliente, con fecha límite y responsable.
- **Vencimientos impositivos:** se cargan a mano por cliente o, mejor, se generan solos desde el **Calendario** (abajo).
- "Hoy" se calcula en horario de Argentina; se cambia con la variable `TZ_NEGOCIO` del `.env`.
- **Mi cuenta:** cada usuario puede cambiar su contraseña (clic en tu nombre, arriba a la derecha).

## Calendario impositivo mensual
1. **Cada mes:** menú *Calendario* → *Cargar calendario del mes (PDF)* y eliges el PDF "Calendario de vencimientos"
   (el formato de Errepar). El sistema lo lee solo.
2. **Revisa** las fechas en pantalla contra el PDF (cada obligación muestra qué terminaciones de CUIT vencen el mismo día;
   con *Editar* corriges cualquier fecha o agregas filas) y pulsa *Guardar calendario*.
3. **En cada cliente** marca sus *Obligaciones impositivas* (IVA, Monotributo, Autónomos, IIBB, etc.).
4. **Aplicar a clientes:** crea el vencimiento de cada cliente activo según el último dígito de su CUIT.
   Si lo aplicas de nuevo no duplica; si corriges una fecha, se actualizan los vencimientos aún pendientes
   (los ya presentados no se tocan).

Las obligaciones se identifican sin mes ni año ("IVA – DDJJ"), así lo que marcaste en cada cliente sirve todos los meses.
Si un PDF no se pudo leer del todo, el sistema avisa qué parte revisar. Los tests usan una copia del PDF en
`backend/tests/fixtures/` (no se sube a git; sin ese archivo ese test se omite).

## Hoja de ruta
3. Honorarios y documentos ·
4. Dashboard, importar/exportar, backups · 5. Despliegue online.
