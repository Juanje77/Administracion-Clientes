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
4. **Documentos adjuntos (opcional):** en la consola de Firebase, *Compilación → Storage → Comenzar* (según el plan puede
   requerir el plan Blaze de pago por uso, que incluye una cuota gratuita). Copia el nombre del *bucket* (ej. `adminclientes-da709.firebasestorage.app`)
   y en *Storage → Reglas* pega el contenido de `storage.rules` y publica: así nadie accede a los archivos salvo el servidor.
5. **Configurar el backend:**
   ```bash
   npm install                # en la carpeta raíz: instala backend y frontend
   cd backend
   cp .env.example .env       # editar FIREBASE_SERVICE_ACCOUNT, JWT_SECRET y FIREBASE_STORAGE_BUCKET
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
   | `FIREBASE_STORAGE_BUCKET` | nombre del bucket de Storage (solo para los documentos adjuntos) |
   | `SMTP_USER` / `SMTP_PASS` | tu cuenta de Gmail y su *contraseña de aplicación* (solo para los avisos por email) |
   | `ESTUDIO_NOMBRE` | nombre que aparece en los emails (ej. `Estudio Costantini`) |
   | `APP_URL` | dirección del sistema, para el botón "Abrir la agenda" de los resúmenes |
   | `CRON_SECRET` | texto largo aleatorio: protege el envío automático diario |
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
- **Tamaño de archivos:** Vercel limita el cuerpo de una petición a 4,5 MB, por eso los documentos adjuntos tienen un máximo de 4 MB (suficiente para PDF y fotos comunes).

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
- `documentos/{id}`: clienteId, nombre, categoría, tipo, tamaño, ruta en Storage, quién lo subió
- `config/avisos`, `envios/{clave}` (historial y reserva anti-duplicados) y `avisosCliente/{clienteId}` (último aviso de deuda)
- `resumenes/{AAAA-MM}` (totales para el Inicio) y `resumenes/_estado`
- `calendarios/{AAAA-MM}`: filas del calendario mensual con la fecha para cada terminación de CUIT (0–9)

Firestore no busca texto parcial, así que el servidor guarda la lista de clientes en memoria y filtra/ordena ahí.
Cada instancia valida su copia con el documento `meta/clientes` (contador de versión que sube en cada cambio),
por eso funciona también con varias instancias a la vez. Es adecuado para hasta unos pocos miles de clientes.
Las tareas y vencimientos pendientes llevan un campo auxiliar (`alerta`) que desaparece al cerrarlos, para consultar
solo lo pendiente sin leer el historial.

## Estilo visual
Diseño de marca "Juan Costantini": azul marino `#0c284b` (hover `#1d4373`), fondo `#f4f5f7`, bordes de 1 px `#cfd6e0`, esquinas rectas y sin sombras.
Títulos en Barlow Condensed 600 (mayúsculas) y cuerpo en Barlow (paquetes `@fontsource`, sin depender de Google en ejecución). Barra lateral azul marino en
escritorio y barra superior con menú en el celular; estados como etiquetas con borde de color (Al día/Pagada `#2f6b4f`, Pendiente `#8a6212`, Vencido `#a33a2f`).
Los logos están en `frontend/public/` (`logo-1.png` monograma blanco, `logo-3.png` logo completo, ambos con fondo transparente, y `favicon.png`).
Los colores y fuentes se definen en `frontend/tailwind.config.js` y las clases comunes (`.btn-primario`, `.campo`, `.panel`, `.insignia-*`) en `frontend/src/index.css`.

## Quién ve el dinero
**Todo lo que es dinero lo ve únicamente quien tiene acceso a los montos.** Los administradores siempre lo tienen; un usuario común **no lo tiene por defecto** y un administrador
puede dárselo o quitárselo en cualquier momento desde *Usuarios* (casilla "Puede ver honorarios, cobros, deudas y montos"). Es el servidor el que lo aplica, no solo la pantalla.

| Sin acceso a los montos | Con acceso |
|---|---|
| Ve clientes, agenda, tareas, calendario, documentos e Inicio con clientes y pendientes | Además: Honorarios, cobros y deudores |
| No ve el abono mensual del cliente y no puede cambiarlo | Ve y edita el abono |
| El Inicio no muestra cobrado, facturado, deuda, gráfico ni deudores | Inicio completo |
| No puede descargar honorarios ni deudores; la planilla de clientes no trae el abono | Todas las exportaciones |
| Su resumen diario por email no incluye la deuda | El resumen incluye los deudores |

Anular un cobro o borrar un honorario sigue siendo solo de administradores, tengan o no acceso a los montos.
Los cambios valen desde la siguiente petición de esa persona (sin que tenga que volver a entrar; en producción puede demorar hasta 30 segundos).
**Desactivar a un usuario cierra su sesión de inmediato** (antes seguía valiendo hasta 8 horas).

## Quién ve qué clientes

Cada persona del equipo (no administradora) tiene un acceso a clientes:

- **Solo los clientes que se le asignen** (valor por defecto para usuarios nuevos).
- **Todos los clientes** (los usuarios que ya existían antes de esta función lo conservan hasta que se los restrinja).

Los administradores ven todo. La asignación se hace desde los dos lados, sobre los mismos datos (`responsables` en el cliente): en la ficha del cliente (*Quién puede ver este cliente*) o en **Usuarios → Asignar clientes**.

Para quien tiene acceso limitado, un cliente ajeno **no existe** (404) en todo el sistema: lista, ficha, interacciones, tareas, vencimientos, honorarios y cobros, documentos, Agenda, pendientes urgentes, exportaciones y el resumen diario por email. Reglas adicionales:

- Una tarea de un cliente **no se puede asignar** a quien no lo ve: primero hay que darle acceso al cliente (o elegir a otra persona). Las tareas internas (sin cliente) pueden ir a cualquiera.
- Quien crea un cliente con acceso limitado queda como responsable de ese cliente. Solo un administrador cambia los responsables.
- Generar los honorarios del mes y aplicar el calendario requieren ver todos los clientes. Los totales del estudio en el Inicio (facturado, cobrado, deuda total) tampoco se muestran a quien ve solo algunos clientes; en Honorarios ve lo de sus clientes.
- Los cambios de acceso valen desde la siguiente petición de esa persona.

## Roles
- **Administrador:** gestiona usuarios y puede eliminar clientes definitivamente.
- **Usuario:** opera clientes e interacciones. "Eliminar" archiva (estado Inactivo).

## Agenda, tareas y vencimientos (Etapa 2)
- **Agenda:** pendientes vencidos, de hoy y de los próximos 7 días; el menú muestra un aviso rojo con la cantidad de urgentes.
- **Tareas:** se crean desde la **Agenda** (*+ Nueva tarea*) o dentro de la ficha de un cliente. Cada tarea tiene **un responsable** (cualquier persona activa del equipo),
  fecha límite y un detalle opcional. Pueden ser **internas** (sin cliente, ej. "Renovar el seguro"). Se pueden **editar y reasignar** en cualquier momento; en la Agenda se ven
  las tuyas, las de todo el equipo o las de una persona. Cuando asignas una tarea a otra persona le llega un **email** (si el correo está configurado y no lo desactivó en *Mi cuenta*);
  editar el título o la fecha no vuelve a enviar nada, y asignártela a ti mismo tampoco.
- **Vencimientos impositivos:** se cargan a mano por cliente o, mejor, se generan solos desde el **Calendario** (abajo).
- "Hoy" se calcula en horario de Argentina; se cambia con la variable `TZ_NEGOCIO` del `.env`.
- **Mi cuenta:** cada usuario puede cambiar su contraseña (clic en tu nombre, arriba a la derecha).

## Avisos por email
Cada mañana de **lunes a viernes (8:00 hs, hora de Argentina)** el sistema envía:
- **Resumen al equipo:** a cada usuario, sus tareas y los vencimientos impositivos (vencidos, de hoy y de la semana); a los administradores, además, los deudores.
  Solo se envía si hay algo pendiente, y cada persona puede apagarlo en *Mi cuenta*.
- **Recordatorio de vencimientos a clientes** (opcional): un email con sus vencimientos de los próximos días (3 por defecto), **una sola vez por vencimiento**.
- **Recordatorio de honorarios a clientes** (opcional): los meses atrasados que debe, con el texto de cómo pagar que cargues; se repite como máximo cada 15 días por cliente.

**Resguardos:** los avisos a clientes vienen **apagados**; los activa un administrador en *Avisos*, donde también hay *correo de prueba*, *vista previa* de lo que saldría hoy
y un historial de envíos. Un cliente solo recibe avisos si está **activo**, tiene **email** y su casilla "recordatorios" (en su ficha) está marcada. Cada envío se reserva antes
de mandarse, así que reintentar o apretar "Enviar ahora" dos veces no duplica nada; si un envío falla se reintenta en la siguiente ejecución. Los correos a clientes llevan el aviso
"si no desea recibir más, responda este correo".

**Configurar Gmail:** en tu cuenta de Google activa la *verificación en dos pasos* y crea una *contraseña de aplicación* (myaccount.google.com/apppasswords).
Esa clave de 16 letras es `SMTP_PASS` y tu dirección de Gmail es `SMTP_USER` (por defecto se usa `smtp.gmail.com`, puerto 465; se cambian con `SMTP_HOST` y `SMTP_PORT`).
Opcionales: `MAIL_FROM` (remitente completo) y `MAIL_REPLY_TO` (a dónde llegan las respuestas de los clientes).

**Envío automático en Vercel:** `vercel.json` ya incluye el cron (`0 11 * * 1-5`, que son las 8:00 de Argentina). Solo hace falta cargar `CRON_SECRET`; Vercel lo envía solo al llamar.
En el plan gratuito de Vercel los crons corren una vez por día con una ventana de hasta una hora. Sin `CRON_SECRET` el cron queda cerrado, pero puedes usar *Enviar ahora* a mano.

**Logo en los mails:** el monograma viaja adjunto dentro de cada mensaje (`backend/src/correo/logo-estudio.png`), así que se ve sin depender de `APP_URL`. Para cambiarlo, reemplazá ese archivo.

**Límites:** una cuenta de Gmail común permite unos 500 destinatarios por día y puede mandar a spam si se envía mucho: para muchos clientes conviene una cuenta
de Google Workspace o un dominio propio. Cada ejecución se corta a los ~22 segundos para respetar el tiempo máximo de la función; lo que quede sale en la siguiente.
El historial (`envios`) no guarda el contenido de los correos y no se borra solo.

## Documentos adjuntos
En la ficha de cada cliente: subir contratos, presupuestos, facturas, constancias o balances (PDF, imágenes, Word, Excel, CSV o texto; máx. 4 MB).
- Los archivos se guardan en Firebase Storage y **solo se descargan con sesión iniciada**: no hay enlaces públicos.
- Al subir se verifica el contenido real (un `.exe` o una página web renombrada a `.pdf` se rechazan) y el nombre original se limpia; en el
  bucket el archivo se guarda con un identificador, no con su nombre.
- PDF e imágenes se pueden *Ver* en el navegador; el resto se descarga. Borra quien lo subió o un administrador.
- Sin `FIREBASE_STORAGE_BUCKET` el resto del sistema funciona y la sección Documentos avisa qué falta.

## Inicio (dashboard) y exportaciones
- **Inicio** muestra, para el mes elegido: lo cobrado (cifra principal) y lo facturado, la deuda total, clientes activos y nuevos,
  pendientes urgentes, un gráfico de **cobrado por mes** (últimos 6 meses, con tooltip y vista de tabla) y los 5 mayores deudores.
  Los totales de facturado y cobrado salen de `resumenes/{AAAA-MM}`, documentos que se actualizan solos con cada honorario y cada cobro: el Inicio lee 6 documentos
  pequeños y **no necesita índices de Firestore**. La primera vez se arman solos con lo que ya hay; si alguna vez no coinciden, un administrador puede usar *Recalcular totales* (al pie del Inicio).
  Si un bloque del Inicio falla, los demás se muestran igual y se indica cuál faltó.
- **Exportar:** *Clientes* → Excel o CSV (respeta los filtros de la lista; el Excel se puede volver a importar); *Honorarios* → Excel o PDF del mes;
  *Deudores* → Excel o PDF. El CSV usa `;` y acentos correctos para Excel en español, y neutraliza celdas que empiecen con `=`, `+`, `-` o `@`.
- Los totales mensuales están en `resumenes/{AAAA-MM}` (facturado y cobrado; el cobrado cuenta en el mes de la fecha del cobro).
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

## Tareas recurrentes y cierre de balance

- **Tareas:** pueden ser de una sola vez (por defecto) o repetirse cada semana, mes o año. Al completar una recurrente se crea sola la siguiente (misma persona y cliente, fecha corrida; el 31 pasa a fin de mes si el siguiente es más corto). Reabrir y volver a completar no duplica.
- **Personas jurídicas:** llevan el **mes de cierre de balance** (obligatorio si están Activas; también se importa/exporta como columna). La DDJJ de Ganancias Sociedades vence en el mes que el calendario indica para ese cierre ("DDJJ - Cierre: Mayo/2026" en el calendario de octubre), con el día según el último dígito del CUIT. Al crear/editar la sociedad, o al aplicar un calendario, solo se genera el vencimiento de la fila que coincide con su cierre. Si falta el mes de cierre, no se genera y se avisa. Los **anticipos de personas jurídicas** también dependen del cierre: el calendario trae una sola fila con una tabla "cierre → Nº de anticipo"; cada sociedad recibe el vencimiento solo si su cierre figura ese mes (con el Nº de anticipo en el nombre). El caso "solo aplicable a Fondo Cooperativo" no se genera.

## Calendario impositivo mensual

Al **crear o editar un cliente** activo con obligaciones marcadas (y CUIT), sus vencimientos pasan solos a la Agenda con la fecha que le corresponde según el último dígito del CUIT, para todos los calendarios ya cargados (se omiten fechas ya pasadas). "Aplicar a los clientes" sigue sirviendo al cargar un calendario nuevo.
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
