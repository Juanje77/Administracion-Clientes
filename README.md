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
   npm install                # en la carpeta raíz: instala backend y frontend
   cd backend
   cp .env.example .env       # editar FIREBASE_SERVICE_ACCOUNT y JWT_SECRET
   npm run seed -- tu@email.com "TuClaveSegura" "Tu Nombre"   # primer administrador
   ```

## Ejecutar en desarrollo
Dos terminales:
```bash
npm run dev:api                 # API en http://localhost:3001 (usa tu Firestore real)
npm run dev:web                 # App en http://localhost:5173
```
Para desarrollar **sin tocar datos reales**, usa el emulador local:
`npm run dev:emu` (en `backend/`) y crea el admin con
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed -- ...`.

## Producción en un servidor propio (alternativa a Vercel)
```bash
npm run build                   # genera frontend/dist
cd backend && NODE_ENV=production npm start
```
El servidor entrega la API y el frontend compilado en un mismo puerto.

## Despliegue en Vercel
El proyecto ya trae la configuración (`vercel.json` y `api/index.js`): el frontend se publica como archivos
estáticos y la API corre como función en `/api/*`.

1. Sube el código a GitHub (ya está) y en https://vercel.com → *Add New → Project* importa el repositorio.
   Deja el *Root Directory* en la raíz; Vercel lee `vercel.json` (no hace falta elegir framework).
2. En *Environment Variables* agrega:
   | Variable | Valor |
   |---|---|
   | `JWT_SECRET` | un texto largo y aleatorio (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |
   | `FIREBASE_SERVICE_ACCOUNT` | el **contenido completo** del archivo `.json` de la cuenta de servicio, pegado tal cual |
   | `TZ_NEGOCIO` | opcional; por defecto `America/Argentina/Buenos_Aires` |
3. *Deploy*. Cada `git push` a la rama de producción vuelve a desplegar solo.
4. El primer administrador se crea una sola vez desde tu PC con `npm run seed` (apunta a tu Firestore real).
5. Recomendado: en *Settings → Functions* elige la región más cercana a tu base de Firestore
   (por ejemplo São Paulo `gru1` si la base está en `southamerica-east1`).

Cosas a tener en cuenta:
- **Plan de Vercel:** el plan gratuito (Hobby) es solo para uso personal y no comercial; para el estudio
  corresponde un plan de pago. Revisa las condiciones vigentes en vercel.com/pricing.
- **Lecturas de Firestore:** cada pantalla usa pocas lecturas (la lista de clientes se valida con un único
  documento-contador y las alertas usan consultas de conteo). El plan gratuito de Firestore permite 50.000 lecturas por día.
- **Límite de intentos de login:** en Vercel se cuenta por instancia de la función, así que es un freno parcial.
- **Tamaño de archivos:** Vercel limita el cuerpo de una petición a 4,5 MB (suficiente para los PDF de calendario).

## Tests
```bash
npm test                        # levanta el emulador de Firestore automáticamente (requiere Java 11+)
```

## Modelo de datos (Firestore)
- `usuarios/{id}`: nombre, email, passwordHash, rol, activo
- `clientes/{id}`: datos del cliente + `etiquetas` (lista de textos)
  - `interacciones/{id}` (subcolección): tipo, fecha, detalle, autor
- `cuits/{11 dígitos}`: reserva que garantiza un CUIT único
- `tareas/{id}`: clienteId, título, `vence` (AAAA-MM-DD), asignadoA, hecha
- `vencimientos/{clienteId_impuesto_período}`: impuesto, período, `vence`, estado (PENDIENTE/PRESENTADO). El ID evita duplicados.
- `honorarios/{id}`: clienteId, período, concepto, monto, pagado, saldo; y `pagos/{id}` (honorarioId, clienteId, fecha, monto, medio, nota)
- `calendarios/{AAAA-MM}`: filas del calendario mensual con la fecha para cada terminación de CUIT (0–9)

Firestore no busca texto parcial, así que el servidor guarda la lista de clientes en memoria y filtra/ordena ahí.
Cada instancia valida su copia con el documento `meta/clientes` (contador de versión que sube en cada cambio),
por eso funciona también con varias instancias a la vez. Es adecuado para hasta unos pocos miles de clientes.
Las tareas y vencimientos pendientes llevan un campo auxiliar (`alerta`) que desaparece al cerrarlos, para consultar
solo lo pendiente sin leer el historial.

## Roles
- **Administrador:** gestiona usuarios y puede eliminar clientes definitivamente.
- **Usuario:** opera clientes e interacciones. "Eliminar" archiva (estado Inactivo).

## Agenda, tareas y vencimientos (Etapa 2)
- **Agenda:** pendientes vencidos, de hoy y de los próximos 7 días; el menú muestra un aviso rojo con la cantidad de urgentes.
- **Tareas:** se crean dentro de cada cliente, con fecha límite y responsable.
- **Vencimientos impositivos:** se cargan a mano por cliente o, mejor, se generan solos desde el **Calendario** (abajo).
- "Hoy" se calcula en horario de Argentina; se cambia con la variable `TZ_NEGOCIO` del `.env`.
- **Mi cuenta:** cada usuario puede cambiar su contraseña (clic en tu nombre, arriba a la derecha).

## Inicio (dashboard) y exportaciones
- **Inicio** muestra, para el mes elegido: lo cobrado (cifra principal) y lo facturado, la deuda total, clientes activos y nuevos,
  pendientes urgentes, un gráfico de **cobrado por mes** (últimos 6 meses, con tooltip y vista de tabla) y los 5 mayores deudores.
  Las sumas usan consultas de agregación de Firestore, así que cuestan pocas lecturas.
- **Exportar:** *Clientes* → Excel o CSV (respeta los filtros de la lista; el Excel se puede volver a importar); *Honorarios* → Excel o PDF del mes;
  *Deudores* → Excel o PDF. El CSV usa `;` y acentos correctos para Excel en español, y neutraliza celdas que empiecen con `=`, `+`, `-` o `@`.
- Los cobros viven en la colección `pagos` (con `honorarioId`, `clienteId` y `fecha`) para poder sumarlos por fecha en todo el estudio.

## Honorarios y cobros
- En cada cliente cargas su **abono mensual**. En *Honorarios → Generar abonos del mes* se crea el honorario del mes de cada
  cliente **activo** con abono (si lo generas dos veces no duplica). También puedes agregar honorarios sueltos (ej. "Balance anual") dentro del cliente.
- Los **cobros** se registran uno a uno (parciales o totales, con fecha, medio de pago y nota). No se puede cobrar más que el saldo.
  El saldo = facturado − cobrado y se actualiza solo. Un honorario con saldo de un mes ya terminado figura como *Vencido*.
- *Deudores* muestra cuánto debe cada cliente sumando todos los meses. Solo un administrador puede anular un cobro o borrar un honorario.
- Los importes se guardan con centavos. Colecciones: `honorarios` y `pagos`.

## Importar clientes desde Excel / CSV
Solo administradores: *Clientes → Importar desde Excel*.
1. Sube tu planilla (.xlsx o .csv; hay una plantilla de ejemplo para descargar). Las columnas se reconocen por su nombre
   (Nombre/Cliente/Razón social, CUIT/CUIL/DNI, Correo, Celular, Localidad, Condición IVA, Estado, Etiquetas, Notas…) y puedes corregirlas.
2. La **vista previa** no guarda nada: marca cada fila como *Listo*, *Revisar* (se importa, con un dato dudoso) o *Se omite*.
3. Al confirmar se crean los clientes. Reglas: un CUIT inválido, un DNI, un email o teléfono raro no frenan la fila (el dato
   original queda en *Notas*); solo se omiten las filas sin nombre y los duplicados (mismo CUIT, o mismo nombre si no hay CUIT).
   Sin estado en la planilla: queda *Activo* si tiene CUIT y condición IVA, y *Potencial* si no. Importar dos veces el mismo archivo no duplica.

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
