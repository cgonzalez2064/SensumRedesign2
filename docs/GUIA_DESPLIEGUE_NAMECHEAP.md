# Guía de despliegue en Namecheap (Stellar Plus + cPanel)

Paso a paso para poner en línea el sitio de **sensumconstrucciones.com** con el
Administrador de contenido: archivos, base de datos, correo (formulario de
contacto, alertas, informes), cuenta propietaria, usuarios, fotos, tareas
programadas y verificación final.

Tiempo estimado: 1 a 2 horas la primera vez. No necesitas conocimientos de
programación; sí acceso a **cPanel** y a la cuenta de **Namecheap**.

> **Nunca envíes contraseñas por correo ni por chat** (tampoco a soporte). Las
> contraseñas y claves solo se escriben en el panel (**Administración → Correo**, donde
> se guardan cifradas), en el archivo `.env` del servidor (paso 9) y en un gestor de
> contraseñas.

**Novedad:** el correo (cuenta de envío, formulario de contacto, destino de reportes y
alertas) y el captcha del formulario **se configuran desde el panel**, no en archivos.
El `.env` queda con 5 líneas obligatorias.

---

## 0. Cómo queda todo en el servidor

```
/home/USUARIO/                      ← tu carpeta en el hosting (USUARIO = usuario de cPanel)
├── public_html/                    ← lo que ve el público (sitio web)
│   ├── index.html, 404.html, privacy-notice.html   ← páginas (las regenera el panel)
│   ├── assets/                     ← estilos, scripts, imágenes del diseño
│   │   ├── contact-handler.php     ← formulario de contacto (captcha + envío según el panel)
│   │   └── uploads/                ← FOTOS y PDF que se suben desde el panel
│   ├── admin/                      ← el panel: https://sensumconstrucciones.com/admin/
│   └── api/index.php               ← única puerta de entrada al panel
└── sensum-cms/                     ← PRIVADO (fuera de public_html; nadie lo ve desde internet)
    ├── .env                        ← configuración y contraseñas (lo creas tú, paso 9)
    ├── src/, vendor/, templates/…  ← el programa
    └── storage/                    ← base de datos, registros, respaldos, capturas de reportes
        ├── database.sqlite         ← LA base de datos (se crea sola)
        ├── logs/                   ← registro técnico
        ├── backups/                ← copias de la base de datos y de las páginas
        └── reports/                ← capturas de pantalla de «Reportar un problema»
```

**Dónde se guardan las fotografías:** en `public_html/assets/uploads/`. El panel
las recorta, las optimiza (formato WebP, tamaños de 800 y 1600 px) y les pone un
nombre propio (por ejemplo `proj2-card-3f9a1c0b7e2d-w1600.webp`). La base de datos
guarda qué foto va en cada lugar y su descripción. **Respalda siempre juntas** la
carpeta `uploads` y la base de datos.

**La base de datos:** es un solo archivo, `sensum-cms/storage/database.sqlite`
(SQLite). **No hay que crear nada en cPanel → MySQL Databases**: no hay usuario ni
contraseña de base de datos que configurar. Se crea y se actualiza sola la primera
vez que alguien entra al panel. Para respaldarla basta con copiar ese archivo (o
usar el comando de respaldo del paso 16).

---

## 1. Lo que necesitas reunir antes de empezar

| Qué | Dónde se obtiene | Para qué |
|---|---|---|
| Acceso a cPanel | Namecheap → Dashboard → Hosting List → **Go to cPanel** | Todo el proceso |
| Usuario de cPanel (aparece arriba a la derecha en cPanel) | cPanel | Rutas como `/home/USUARIO/` |
| Nombre del servidor de correo | cPanel → Email Accounts → **Connect Devices** (o el correo de bienvenida de Namecheap, sección *Account Information*) | Panel → Correo → Servidor |
| Contraseña nueva para `notificaciones@sensumconstrucciones.com` | La creas en el paso 6 (usa un gestor de contraseñas) | Cuenta de envío del panel |
| Buzón que recibe el formulario de contacto | `contacto@sensumconstrucciones.com` | Que los mensajes de clientes lleguen |
| Correo de soporte | `it@gruposensum.com` | Reportes, alertas, recordatorios y cuenta propietaria |
| (Opcional, recomendado) Cuenta gratuita de Cloudflare | https://dash.cloudflare.com (paso 13.3) | Captcha Turnstile en el formulario |
| (Opcional) Clave de DeepL API Free | https://www.deepl.com/pro-api | Traducción automática ES ⇄ EN |
| (Opcional) Clave de Google PageSpeed | Google Cloud Console (paso 19) | «Visibilidad en Google» del informe mensual |
| (Opcional) Cuenta gratuita de Better Stack | https://betterstack.com | Aviso si el sitio deja de responder |

El dominio debe apuntar al hosting de Namecheap (DNS de Namecheap hosting), o el
certificado HTTPS no se podrá emitir.

---

## 2. Respaldar el sitio actual

1. cPanel → **File Manager** → abre `public_html`.
2. Selecciona todo → **Compress** → *Zip Archive* → descarga el zip a tu computadora.
3. Opcional y recomendado: cPanel → **Backup** → *Download a Full Account Backup*.

Si algo sale mal, con ese zip vuelves al sitio anterior en minutos (paso 23).

---

## 3. Preparar el paquete en tu computadora

En la carpeta del proyecto (con la rama que quieras publicar, sin cambios pendientes):

```bash
tools/build-release.sh
```

Se crea `dist/release-AAAAMMDD-xxxxxxx.zip` con dos carpetas: `public_html` y
`sensum-cms`. Ya incluye las librerías necesarias (PHPMailer), así que **no
necesitas Composer ni Git en el servidor**.

> Las fotos que subiste en tu panel local **no** van en el paquete (viven en tu
> base de datos local). En producción se vuelven a subir desde el panel (paso 15).

---

## 4. Configurar PHP en cPanel

cPanel → **Select PHP Version** (sección *Exclusive for Namecheap Customers* o
*Software*):

1. **Current PHP version:** 8.2 u 8.3 → *Apply*.
2. Pestaña **Extensions**: marca `pdo_sqlite`, `sqlite3`, `gd`, `fileinfo`,
   `mbstring`, `exif`, `intl`, `curl`, `openssl`, `json`, `zip` (respaldos cifrados),
   `sodium` e `iconv` (algunas ya vienen marcadas).
3. Pestaña **Options**:

| Opción | Valor |
|---|---|
| `memory_limit` | `256M` (procesar fotos grandes) |
| `upload_max_filesize` | `16M` |
| `post_max_size` | `20M` |
| `max_execution_time` | `60` |
| `display_errors` | `Off` |
| `log_errors` | `On` |

---

## 5. Subir los archivos

1. cPanel → **File Manager** → ve a tu carpeta principal `/home/USUARIO` (un nivel
   **arriba** de `public_html`). Activa *Settings → Show Hidden Files (dotfiles)*.
2. **Upload** → sube el zip del paso 3 → clic derecho → **Extract**.
3. Mueve la carpeta `release-…/sensum-cms` a `/home/USUARIO/sensum-cms`.
4. Mueve **el contenido** de `release-…/public_html` dentro de `/home/USUARIO/public_html`
   (reemplaza los archivos del sitio anterior; tu respaldo del paso 2 te protege).
5. Comprueba que se copiaron los archivos ocultos: `public_html/.htaccess`,
   `public_html/admin/.htaccess`, `public_html/api/.htaccess`,
   `public_html/assets/uploads/.htaccess`, `sensum-cms/.htaccess`.
6. Borra la carpeta `release-…` vacía y el zip.

Comprobación rápida: deben existir `/home/USUARIO/sensum-cms/bootstrap.php`,
`/home/USUARIO/sensum-cms/vendor/autoload.php` y `/home/USUARIO/public_html/api/index.php`.

---

## 6. Correo electrónico (lo necesario para que TODO envíe y reciba)

Todo se configura después desde el panel (**Administración → Correo**, paso 13). Aquí
solo creas los correos en cPanel.

| Qué envía | Desde (remitente) | Hacia | Respuestas van a |
|---|---|---|---|
| **Formulario de contacto** del sitio | `formulario@sensumconstrucciones.com` | `contacto@sensumconstrucciones.com` | Al visitante (responder = escribirle al cliente) |
| **Panel**: invitaciones, contraseñas, «Reportar un problema», informe mensual, recordatorios | `notificaciones@sensumconstrucciones.com` | Según el caso | `soporte@sensumconstrucciones.com` |
| **Alertas automáticas** y errores críticos | `notificaciones@sensumconstrucciones.com` | `it@gruposensum.com` | `soporte@sensumconstrucciones.com` |

### 6.1 Correos recomendados para `@sensumconstrucciones.com`

cPanel → **Email Accounts** (buzones) y cPanel → **Forwarders** (reenvíos):

| Correo | Crear como | Para qué | Dónde se usa en el panel |
|---|---|---|---|
| `contacto@` | **Buzón** (si ya existe, déjalo) | Recibe los mensajes del formulario y lo que escriben los clientes. Lo atiende ventas / atención al cliente. | Correo → «Recibe los mensajes» |
| `notificaciones@` | **Buzón** con contraseña larga | **Cuenta de envío** del panel (SMTP). Envía invitaciones, contraseñas, reportes, informe mensual, alertas y, con el método recomendado, también el formulario. | Correo → Cuenta de envío del panel |
| `formulario@` | **Reenvío** → `contacto@` | Remitente visible de los mensajes del formulario: permite filtrarlos en la bandeja. Si algún rebote llega, termina en `contacto@`. | Correo → «Correo que envía los mensajes» |
| `soporte@` | **Reenvío** → `it@gruposensum.com` (o buzón propio) | Si alguien responde un aviso o el informe mensual, la respuesta llega a soporte. | Correo → «Las respuestas llegan a» |
| `postmaster@` y `abuse@` | **Reenvío** → `it@gruposensum.com` | Direcciones estándar: otros proveedores avisan aquí de rebotes, bloqueos o spam. | — |
| `dmarc@` | **Buzón** (sin revisar a diario) | Recibe los reportes automáticos DMARC (paso 6.3) sin llenar el correo de IT. | — |

Al crear `notificaciones@`: en la lista, junto al buzón, clic en **Connect Devices** →
*Mail Client Manual Settings* y anota el **Outgoing Server** (suele ser
`mail.sensumconstrucciones.com` o el nombre del servidor, por ejemplo
`server123.web-hosting.com`) y el puerto **465 (SSL)**. Si el certificado del correo no
coincide con tu dominio, usa el nombre del servidor.

> Si ya tenías `no-reply@sensumconstrucciones.com`, puedes usarlo en lugar de
> `notificaciones@`; recomendamos `notificaciones@` + `soporte@` porque las respuestas
> de los clientes a un informe no se pierden.

### 6.2 Mínimo indispensable

Si prefieres crear lo menos posible: **`contacto@`** (buzón) y **`notificaciones@`**
(buzón). En el panel usa `notificaciones@` también como remitente del formulario y deja
vacío «Las respuestas llegan a» (entonces van a `it@gruposensum.com`).

### 6.3 Que los correos no caigan en spam (muy importante)

cPanel → **Email Deliverability** → `sensumconstrucciones.com`:

1. **SPF** y **DKIM**: si aparecen como *Problems Exist*, pulsa **Repair** / **Install
   the suggested record**.
2. **DMARC** (cPanel → Zone Editor → *+ Add Record* → TXT):
   - Nombre: `_dmarc.sensumconstrucciones.com`
   - Valor: `v=DMARC1; p=quarantine; rua=mailto:dmarc@sensumconstrucciones.com`
3. Espera de 15 minutos a unas horas a que se propague.

`it@gruposensum.com` es de otro dominio: pide a quien administra ese correo que
**acepte o marque como seguro** a `notificaciones@sensumconstrucciones.com`.

### 6.4 Límites de Namecheap (Stellar Plus)

- Hasta **200 correos por hora por dominio**: de sobra para este sitio.
- Hasta **50 destinatarios** por correo: por eso el informe mensual admite como
  máximo 20 destinatarios más la copia al propietario.

---

## 7. Permisos

File Manager → clic derecho → **Change Permissions**:

| Ruta | Permiso |
|---|---|
| Carpetas de `public_html` (incluida `assets/uploads`) | `755` |
| Archivos de `public_html` | `644` |
| `sensum-cms` y sus carpetas | `755` |
| `sensum-cms/storage` | `700` |
| `sensum-cms/.env` (después del paso 9) | `600` |

Nunca uses `777`.

---

## 8. HTTPS (certificado de seguridad)

1. Namecheap incluye un certificado PositiveSSL gratis el primer año. En cPanel →
   **Namecheap SSL** (o **SSL/TLS Status**), confirma que `sensumconstrucciones.com`
   y `www.sensumconstrucciones.com` aparecen con certificado activo; si no, pulsa
   **Run AutoSSL** o instálalo con el plugin. Puede tardar hasta 30 minutos.
2. Abre `https://sensumconstrucciones.com` y verifica el candado.

El sitio obliga a usar `https://sensumconstrucciones.com` (sin www) y el panel solo
permite iniciar sesión por HTTPS. **Haz este paso antes de crear la cuenta.**

> Después del primer año, el certificado se renueva comprándolo en Namecheap (se
> instala solo). El informe mensual y el monitoreo te avisan cuando falten menos de
> 3 semanas para que venza.

---

## 9. Crear el archivo de configuración `.env`

File Manager → `/home/USUARIO/sensum-cms/` → **+ File** → nombre `.env` → **Edit**.
Pega esto y reemplaza lo que está entre `< >`:

```ini
# --- Sitio ---
APP_ENV=production
APP_URL=https://sensumconstrucciones.com
APP_TIMEZONE=America/Guatemala

# --- Cuenta propietaria (gestiona usuarios, Monitoreo e Informe mensual) ---
OWNER_EMAIL=it@gruposensum.com

# --- Correo ---
# La cuenta de envío, el formulario, los reportes y las alertas se configuran en el
# panel → Administración → Correo (paso 13). No hace falta escribir aquí el SMTP.
MAIL_DRIVER=smtp
SMTP_TIMEOUT=15

# --- Alertas (destino y cuáles se envían: panel → Correo y Monitoreo) ---
ALERTS_ENABLED=true
ALERT_COOLDOWN_MINUTES=60
ALERT_DAILY_MAX=20
ALERT_LOGIN_FAILURES=10
ALERT_ERROR_SPIKE=25
DISK_WARN_MB=500

# --- Opcionales (déjalos vacíos si aún no los tienes) ---
DEEPL_API_KEY=
PAGESPEED_API_KEY=

# --- Valores recomendados (no hace falta cambiarlos) ---
SESSION_IDLE_MINUTES=60
SESSION_ABSOLUTE_HOURS=12
INVITE_TTL_HOURS=72
RESET_TTL_MINUTES=60
UPLOAD_MAX_MB=10
ERROR_LOG_DAYS=180
PUBLIC_ERROR_REPORTING=false
```

Guarda y pon el permiso del archivo en **600**.

> **Alternativa (opcional):** si prefieres que el correo no se pueda cambiar desde el
> panel, escribe en `.env` los valores `SMTP_HOST`, `SMTP_PORT`, `SMTP_ENCRYPTION`,
> `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_ADDRESS`, `SMTP_REPLY_TO`,
> `SUPPORT_EMAIL`, `ALERT_EMAIL`, `CONTACT_TO`, `CONTACT_FROM_ADDRESS`,
> `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` y agrega `EMAIL_SETTINGS_LOCKED=true`.
> La página Correo queda en solo lectura.

Comprueba la instalación: abre `https://sensumconstrucciones.com/api/health`. Debe
mostrar `"status":"ok"`. (Si dice `service_unavailable`, revisa el paso 5.)

---

## 10. Activar la Terminal de cPanel (una sola vez)

Los pasos 11, 12 y 16 son más fáciles con la Terminal:

1. cPanel → **Manage Shell** (sección *Exclusive for Namecheap Customers*) →
   activa **SSH Access**.
2. Aparece **Terminal** en la sección *Advanced* de cPanel. Ábrela.
3. Averigua la ruta exacta de PHP (la usarás en el paso 16):
   ```bash
   which php
   ```
   Si muestra una versión distinta a la elegida en el paso 4, usa la ruta de esa
   versión, por ejemplo `/opt/alt/php82/usr/bin/php`.

---

## 11. Crear la cuenta propietaria (it@gruposensum.com)

En la Terminal:

```bash
php ~/sensum-cms/bin/console check
```

Todas las líneas obligatorias deben decir `OK` (las opcionales pueden decir `WARN`).
Después:

```bash
php ~/sensum-cms/bin/console create-admin --name="Soporte IT" --email=it@gruposensum.com
```

Escribe la contraseña dos veces (no se ve al escribir; mínimo 10 caracteres). Debe
responder *«This is the owner account…»*.

**Sin Terminal:** agrega al `.env` una línea `SETUP_TOKEN=` con un valor largo
aleatorio (de tu gestor de contraseñas), abre
`https://sensumconstrucciones.com/admin/#/configurar`, escribe ese valor, el nombre,
`it@gruposensum.com` y la contraseña. Al terminar, **borra la línea `SETUP_TOKEN`**.

Entra a `https://sensumconstrucciones.com/admin/` con esa cuenta. **La primera vez el
panel te pedirá activar la verificación en dos pasos** (obligatoria para la cuenta
propietaria):

1. Instala en tu celular Google Authenticator, Microsoft Authenticator o 1Password.
2. Escribe tu contraseña, escanea el código QR y escribe el código de 6 dígitos.
3. Guarda los **10 códigos de recuperación** en tu gestor de contraseñas: sirven si
   pierdes el celular (cada uno funciona una vez).

Si algún día pierdes el celular **y** los códigos, desde la Terminal de cPanel:
`php ~/sensum-cms/bin/console 2fa:reset it@gruposensum.com` (la vuelves a configurar
al entrar).

---

## 12. Primera publicación

En el panel → **Inicio**: si aparece «El sitio publicado no coincide…», pulsa
**Volver a publicar el sitio**. O en la Terminal:

```bash
php ~/sensum-cms/bin/console publish
```

---

## 13. Configurar el correo y el captcha en el panel

Hazlo **antes de invitar usuarios** (las invitaciones salen por correo). Panel →
**Administración → Correo** (solo la cuenta propietaria lo ve). Al guardar, el panel
pide tu contraseña otra vez y te envía un aviso de seguridad por correo.

### 13.1 Cuenta de envío del panel

| Campo | Valor |
|---|---|
| Correo remitente | `notificaciones@sensumconstrucciones.com` |
| Nombre del remitente | `Sensum Construcciones` |
| Las respuestas llegan a | `soporte@sensumconstrucciones.com` |
| Servidor / Puerto / Seguridad | Botón **«Completar con los datos de Namecheap»** (`mail.sensumconstrucciones.com`, `465`, `SSL`) o lo que anotaste en el paso 6.1 |
| Usuario | `notificaciones@sensumconstrucciones.com` |
| Contraseña | La del buzón `notificaciones@` (se guarda cifrada; nunca se vuelve a mostrar) |

### 13.2 Formulario de contacto y destinatarios

| Campo | Valor |
|---|---|
| Recibe los mensajes | `contacto@sensumconstrucciones.com` (hasta 3, separados por coma) |
| Correo que envía los mensajes | `formulario@sensumconstrucciones.com` |
| Nombre del remitente | `Sitio web Sensum` |
| Cómo se envía | **Con la cuenta de envío del panel (recomendado)** |
| Reportes de problemas | `it@gruposensum.com` |
| Alertas automáticas y errores críticos | `it@gruposensum.com` |

Pulsa **Guardar configuración** y luego **Enviar correo de prueba** y **Enviar mensaje
de prueba**: deben llegar a `it@gruposensum.com` y a `contacto@` (revisa spam).

### 13.3 Captcha del formulario (protección contra spam)

- **Captcha integrado: siempre activo, no requiere nada.** El navegador del visitante
  resuelve una verificación invisible (prueba de trabajo firmada por el servidor, de un
  solo uso y con vencimiento de 30 minutos) mientras escribe. Se suma al campo trampa,
  al tiempo mínimo de llenado y al límite de 5 envíos cada 10 minutos por visitante.
- **Cloudflare Turnstile (opcional, recomendado):** agrega la detección de robots de
  Cloudflare. Es gratis, no muestra imágenes y solo pide un clic si algo parece
  sospechoso. **No necesitas mover el dominio a Cloudflare.**
  1. Crea una cuenta en https://dash.cloudflare.com → **Turnstile** → **Add widget**.
  2. Nombre `Sitio Sensum`, dominio `sensumconstrucciones.com` (agrega también
     `www.sensumconstrucciones.com`), modo **Managed** → *Create*.
  3. Copia la **Site Key** y la **Secret Key** en panel → Correo → *Protección contra
     spam (captcha)* → **Guardar configuración**. El sitio se vuelve a publicar solo.
  4. Para desactivarlo: borra la Site Key y guarda.
  5. Si Cloudflare no responde, el formulario sigue funcionando con el captcha
     integrado y Monitoreo lo registra. Si la Secret Key es incorrecta, también sigue
     funcionando y llega una alerta para corregirla.
- Si activas Turnstile, menciona en el Aviso de Privacidad que el formulario usa
  Cloudflare Turnstile para prevenir spam (Cloudflare procesa datos técnicos del
  navegador).

---

### 13.4 Seguridad: respaldo cifrado fuera del servidor

Panel → **Administración → Seguridad**:

1. **Respaldo cifrado fuera del servidor:** activa *Enviar respaldos automáticamente*,
   frecuencia **Semanal**, y en *Enviar a* un correo que **no** dependa de este hosting
   (por ejemplo una cuenta de Gmail de la empresa o de Grupo Sensum).
2. Define la **contraseña de respaldos** (mínimo 12 caracteres) y guárdala en tu gestor
   de contraseñas: sin ella los respaldos no se pueden abrir. Nunca se envía por correo.
3. **Guardar cambios** (te pide tu contraseña) → **Enviar respaldo ahora**. Llega un
   ZIP cifrado (AES-256) con la base de datos, las fotos y `LEEME-RESTAURAR.txt`.
   Ábrelo una vez para comprobarlo: 7-Zip (Windows) o Keka / The Unarchiver (Mac).
4. **Verificación en dos pasos:** elige si se exige solo a la cuenta propietaria
   (predeterminado) o a todo el equipo. Desde la misma lista puedes **restablecerla** a
   quien pierda su celular.

También puedes **Descargar respaldo completo** en cualquier momento (pide tu contraseña).

---

## 14. Crear los usuarios del equipo

Solo la cuenta propietaria puede crear y modificar usuarios.

1. Panel → **Usuarios** → **Invitar usuario**.
2. Nombre, correo y **Tipo de acceso**:

| Tipo de acceso | Puede cambiar |
|---|---|
| Acceso completo al contenido | Textos, datos de contacto, fotos, portafolio, estado del sitio, **Prospectos y Estadísticas** |
| Editor de contenido | Textos, datos de contacto, fotos y portafolio |
| Solo textos | Los textos del sitio (español e inglés) |
| Solo fotos y portafolio | Fotos de «Nosotros» y proyectos, y el PDF |
| Solo datos de contacto | Teléfonos, WhatsApp, correo, dirección, mapa, Instagram |
| Ventas: prospectos | Solo **Prospectos** (mensajes del formulario) y **Estadísticas**; no cambia el sitio |
| Personalizado | La combinación que elijas |

> **Prospectos contiene datos personales** de quienes escriben por el formulario: dales
> ese acceso solo a quienes atienden clientes (por ejemplo, ventas o gerencia).

3. La persona recibe un correo para crear su contraseña (vence en 72 horas). Si el
   correo no sale, el panel te muestra el enlace para compartirlo por otro medio.
4. Para cambiar el acceso después: menú «⋮» de la persona → **Cambiar tipo de
   acceso**. Se aplica de inmediato.

---

> **Cuentas de prueba:** el comando `demo-users` (cuentas `demo.*@example.test`)
> es solo para pruebas en tu computadora y **se niega a funcionar en producción**.
> No lo ejecutes en el servidor; crea las cuentas reales con **Invitar usuario**.

## 15. Cargar las fotografías

Las fotos se suben desde el panel → **Fotos y archivos** (pestañas *Nosotros*,
*Tipos de proyectos*, *Documentos*). Quedan en `public_html/assets/uploads/`.

La selección que hicimos con las fotos de Google Drive está anotada en tu
computadora en `cms/storage/photo-selection-2026-10-07.tsv` (foto, lugar y
descripciones en español e inglés): úsala como lista para subir las mismas fotos
en producción.

---

## 16. Tareas programadas (Cron Jobs)

cPanel → **Cron Jobs**. En *Cron Email* puedes dejar `it@gruposensum.com` (solo
escribe si hay algún error). Agrega dos tareas, usando la ruta de PHP del paso 10:

| Tarea | Frecuencia (Common Settings) | Comando |
|---|---|---|
| **Revisión automática** (monitoreo, alertas pendientes, calificación de Google, certificado, recordatorio del informe, limpieza) | *Twice Per Hour* o personalizado `*/15 * * * *` | `/usr/local/bin/php /home/USUARIO/sensum-cms/bin/console monitor > /dev/null 2>&1` |
| **Respaldo diario** de la base de datos (guarda las últimas 14 copias) | *Once Per Day* | `/usr/local/bin/php /home/USUARIO/sensum-cms/bin/console backup > /dev/null 2>&1` |

Reemplaza `/usr/local/bin/php` por la ruta que mostró `which php` y `USUARIO` por tu
usuario de cPanel. En el panel → **Monitoreo**, «Última revisión automática» debe
mostrar la hora de la última ejecución después de unos minutos.

### Alertas automáticas (llegan al correo de alertas del paso 13.2)

La revisión automática envía estos avisos solo cuando hace falta, sin repetirlos.
Cada uno se activa o desactiva en panel → **Monitoreo → Alertas automáticas**.

| Alerta | Cuándo |
|---|---|
| Errores críticos | Al momento (máx. 1 por hora por el mismo error) |
| Cambios en los archivos del sitio (archivos PHP nuevos, archivos raros entre las fotos, archivos modificados o borrados fuera del panel) | En cada revisión; recordatorio diario si sigue igual |
| Intentos de acceso sospechosos (10+ contraseñas incorrectas en una hora) | Al detectarlo, máx. cada 6 h |
| Inicio de sesión desde un dispositivo nuevo (a la persona que entró) | Al iniciar sesión |
| Certificado HTTPS por vencer | 21, 7 y 1 día antes |
| Vencimiento del dominio (consulta pública RDAP) | 60, 30, 14, 7 y 1 día antes |
| Configuración de correo: SPF, DKIM, DMARC y MX (revisión diaria) | Al detectar un problema; recordatorio semanal |
| Respaldo fuera del servidor fallido o atrasado | Una vez al día mientras siga así |
| Respaldo atrasado (más de 48 h) | Una vez al día |
| Revisión automática detenida (cron sin correr más de 2 h) | Máx. 1 por día |
| Poco espacio en disco (menos de 500 MB) | Una vez al día |
| Aumento inusual de errores (25+ en una hora) | Máx. cada 6 h |
| Resumen técnico semanal (disponibilidad, errores, accesos, formulario y spam bloqueado, respaldos) | Lunes desde las 8:00 |
| Revisión mensual de seguridad (cuentas inactivas, invitaciones, permisos, versión de PHP, respaldos, velocidad) | Día 1 de cada mes desde las 8:00 |
| Recordatorio del informe mensual | Desde el día 6 si no se envió |
| Cambio en la configuración de correo (siempre activo, a la cuenta propietaria) | Al guardar |

La **primera revisión** guarda la lista de archivos del sitio como referencia (el
paquete del paso 3 ya trae la suya: `sensum-cms/release-manifest.json`). Los cambios
que cPanel hace por sí mismo en `.htaccess` (por ejemplo al cambiar la versión de PHP)
se ignoran.

---

## 17. Monitoreo externo (recomendado, gratis)

El panel no puede avisarte si el servidor completo se cae. Para eso:

1. Crea una cuenta gratuita en **Better Stack** (o UptimeRobot).
2. Monitor 1: `https://sensumconstrucciones.com` (estado HTTP 200, alerta de vencimiento SSL).
3. Monitor 2: `https://sensumconstrucciones.com/api/health` (debe contener `"status":"ok"`).
4. Alertas a `it@gruposensum.com`.

---

## 18. Prospectos, estadísticas y tickets: lo que le da valor al cliente

### 18.1 Prospectos (mensajes del formulario)

Desde la instalación, **cada mensaje del formulario de contacto queda guardado** en
panel → **Prospectos**, además de llegar por correo. Si el correo de aviso falla, el
mensaje no se pierde (aparece con un aviso amarillo).

1. Panel → **Prospectos** → **Conservación de datos** (solo la cuenta propietaria):
   elige cuánto tiempo se guardan los mensajes (**24 meses** recomendado). Después se
   borran solos y el **aviso de privacidad** del sitio se actualiza automáticamente.
2. Quien atiende clientes cambia el estado (Nuevo → Contactado → Cotizado → Ganado /
   Perdido), anota el **monto** y agrega **notas**. Todo suma en el informe mensual.
3. **Exportar CSV** abre en Excel o Google Sheets (protegido contra fórmulas maliciosas).

### 18.2 Estadísticas de visitas (sin cookies)

Vienen **activadas**: el sitio cuenta visitas, de dónde llegan (Google, Facebook…),
celular o computadora, y los clics en WhatsApp, teléfono y correo. Se mide **en tu
propio servidor**, sin Google Analytics, sin cookies y sin guardar direcciones IP, así
que **no hace falta banner de cookies**. Quien pide «No rastrear» no se cuenta.

- Panel → **Estadísticas** → *Estadísticas y privacidad*: se pueden desactivar; al
  cambiarlo, el sitio se vuelve a publicar y el aviso de privacidad se ajusta solo.
- Las cifras son algo menores que las de otras herramientas (no cuentan robots ni
  navegadores que piden privacidad): es lo esperado.
- El aviso de privacidad mantiene los **[PLACEHOLDER]** legales que debe revisar
  asesoría legal antes de publicar; los párrafos de estadísticas y conservación ya
  describen el funcionamiento real.

### 18.3 Tickets de soporte: tiempo de respuesta y satisfacción

- Panel → **Reportes de soporte** (cuenta propietaria): arriba ves la **primera
  respuesta promedio**, el **% dentro del objetivo** y la **satisfacción**. Elige el
  objetivo (recomendado **24 h**; 8 h si el contrato lo promete).
- Cuando marcas un ticket como **resuelto**, la persona puede **calificar de 1 a 5**.
  Una calificación de 1–2 marca el ticket como no leído para que lo revises.
- Los tickets resueltos sin respuesta se **cierran solos a los 7 días** (tarea programada).

## 19. Informe mensual para clientes

1. Panel → **Informe mensual** (solo la cuenta propietaria).
2. **Destinatarios:** agrega los correos de tus clientes (máximo 20) → *Guardar
   destinatarios*. La cuenta propietaria va siempre en copia.
3. **Enviarme una prueba** para verlo en tu correo; luego **Enviar informe de {mes}**.
4. Si el informe del mes anterior no se envía en los **primeros 5 días del mes**, la
   cuenta propietaria recibe un **recordatorio** por correo (una vez por mes).
5. El correo lleva **la versión en PDF adjunta** (lista para imprimir o reenviar) y
   compara cada cifra con el **mes anterior** (▲ verde si mejoró, ▼ rojo si empeoró).
   También puedes **Descargar PDF** desde la página del informe.
6. El informe ahora incluye **Visitas y contactos** (visitas, de dónde llegan, clics en
   WhatsApp, mensajes recibidos, servicios más pedidos, cotizados y ganados con su
   monto) y, en Soporte, el **tiempo de primera respuesta** y la **satisfacción**.
   Solo aparece lo que tiene datos.

Para que el informe muestre **«Visibilidad en Google»** (calificaciones de 0 a 100):

1. Entra a https://console.cloud.google.com con una cuenta de Google de la empresa.
2. Crea un proyecto (por ejemplo «Sensum sitio web»).
3. *APIs & Services* → *Library* → busca **PageSpeed Insights API** → **Enable**.
4. *APIs & Services* → *Credentials* → **Create credentials → API key**. En
   *API restrictions* limita la clave a **PageSpeed Insights API**.
5. Pega la clave en `.env` → `PAGESPEED_API_KEY=…`. No requiere tarjeta para el
   uso de este sitio. La revisión automática actualiza las calificaciones una vez al día.

---

## 20. Traducción automática (opcional)

1. Crea una cuenta **DeepL API Free** en https://www.deepl.com/pro-api (el plan API,
   no la app). Copia la clave (termina en `:fx`).
2. Pégala en `.env` → `DEEPL_API_KEY=…`.
3. Compruébalo: `php ~/sensum-cms/bin/console translate:test`.

---

## 21. Verificación final

- [ ] `https://sensumconstrucciones.com` se ve igual que antes, en celular y computadora; el botón EN funciona.
- [ ] `https://sensumconstrucciones.com/api/health` → `"status":"ok"`.
- [ ] **Formulario de contacto:** envía un mensaje real desde el sitio (en celular y computadora). Bajo el botón aparece «Verificación anti-spam completa.» y el mensaje llega a `contacto@sensumconstrucciones.com` con remitente `formulario@`; al responderlo, la respuesta va al visitante.
- [ ] (Si activaste Turnstile) el formulario sigue enviando y no muestra errores; en Cloudflare → Turnstile aparecen las verificaciones.
- [ ] **Reportes de soporte:** con otra cuenta envía un reporte de prueba; como it@gruposensum.com ábrelo, usa **Pedir más información** y luego **Marcar como resuelto**; la persona recibe ambos correos.
- [ ] (Opcional) Panel → **Formulario de contacto**: ajusta las opciones de «Servicio de interés» a los servicios que ofreces hoy y pulsa **Guardar y publicar**; compruébalo en el sitio (español e inglés).
- [ ] **Correo del panel:** panel → Correo → **Enviar correo de prueba** → llega a it@gruposensum.com.
- [ ] Inicias sesión en `/admin/` como it@gruposensum.com; ves Usuarios, Monitoreo, Informe mensual y Correo.
- [ ] Monitoreo → **Alertas automáticas**: todas activadas. **Archivos del sitio → Revisar ahora**: «Todo en orden».
- [ ] Monitoreo → **Correo y dominio → Revisar ahora**: SPF, DKIM, DMARC y MX en verde, y la fecha de vencimiento del dominio.
- [ ] Verificación en dos pasos activa en la cuenta propietaria (y códigos de recuperación guardados).
- [ ] Seguridad → **Enviar respaldo ahora**: el ZIP llega al correo elegido y se abre con la contraseña de respaldos.
- [ ] **Reportar un problema** (botón arriba en el panel) → llega a it@gruposensum.com con el nuevo diseño.
- [ ] **Monitoreo → Enviar correo de prueba** → llega la alerta de prueba.
- [ ] **Informe mensual → Enviarme una prueba** → llega.
- [ ] Invitas a una persona con «Solo textos» → solo ve «Textos del sitio».
- [ ] Cambias un texto, lo ves en el sitio (recarga con Ctrl+F5) y lo restauras.
- [ ] Subes una foto de proyecto y aparece en la tarjeta.
- [ ] Monitoreo → «Última revisión automática» muestra una hora reciente (cron funcionando).
- [ ] Después de enviar el mensaje de prueba del formulario: aparece en **Prospectos** (con el enlace «Prospecto #…» en el correo). Cámbialo a «Contactado» y agrega una nota.
- [ ] Prospectos → **Conservación de datos** elegida; el aviso de privacidad (`/privacy-notice.html`) dice el mismo número de meses.
- [ ] Abre el sitio en tu celular (sin «No rastrear») y toca el botón de WhatsApp: al rato, **Estadísticas** muestra la visita y el clic.
- [ ] Reportes de soporte: objetivo de respuesta elegido; resuelve el ticket de prueba y califícalo con la otra cuenta.
- [ ] **Informe mensual → Descargar PDF** se abre bien; la prueba por correo trae el PDF adjunto.
- [ ] Better Stack muestra ambos monitores en verde.

---

## 22. Publicar actualizaciones más adelante

1. Respalda (paso 2) y ejecuta `php ~/sensum-cms/bin/console backup`.
2. Genera el nuevo paquete (paso 3) y súbelo/extráelo en `/home/USUARIO`.
3. Reemplaza los archivos **sin borrar**: `sensum-cms/.env`, `sensum-cms/storage/` y
   `public_html/assets/uploads/` (ahí están tu configuración, la base de datos y las fotos).
4. Panel → **Volver a publicar el sitio** (o `bin/console publish`). Las
   actualizaciones de la base de datos se aplican solas.
5. La revisión de archivos usa automáticamente la lista del nuevo paquete. Si alguna
   vez cambias un archivo del sitio a mano (a propósito), confirma el cambio en panel →
   **Monitoreo → Archivos del sitio → Revisar ahora → Marcar como esperados** (pide tu
   contraseña) o con `php ~/sensum-cms/bin/console integrity:accept`.

**Alternativa con Git (cPanel → Git Version Control):** cPanel puede clonar el
repositorio de GitHub y desplegarlo con un archivo `.cpanel.yml`, pero entonces
necesitas Composer en el servidor para instalar PHPMailer (en Namecheap compruébalo
con `composer -V` en la Terminal) y un `.cpanel.yml` que copie solo las carpetas
correctas. El paquete zip de esta guía es más simple y no depende de eso.

---

## 23. Volver atrás (si algo sale mal)

- **Solo el sitio público:** sube y extrae el zip del paso 2 en `public_html`.
- **La base de datos:** reemplaza `sensum-cms/storage/database.sqlite` por una copia
  de `sensum-cms/storage/backups/db/`.
- **Si el hosting se perdió por completo:** abre el último respaldo cifrado (correo o
  descarga) con la contraseña de respaldos, sube un paquete nuevo (paso 3–5), reemplaza
  `sensum-cms/storage/database.sqlite` por el del respaldo, copia las fotos a
  `public_html/assets/uploads/` y pulsa **Volver a publicar el sitio**.
- **Las páginas publicadas:** hay copias automáticas en
  `sensum-cms/storage/backups/published/` (las últimas 30 publicaciones): copia los
  archivos de la carpeta de la fecha que quieras a `public_html`.

---

## 24. Solución de problemas

| Síntoma | Causa probable y solución |
|---|---|
| `/api/health` dice `service_unavailable` | Falta `sensum-cms/vendor` o la carpeta no está junto a `public_html`. Revisa el paso 5. |
| No puedes iniciar sesión (te regresa al inicio) | Falta HTTPS (paso 8) o `APP_URL` no es exactamente `https://sensumconstrucciones.com`. |
| «No pudimos verificar la solicitud por seguridad» | Entraste por `www.` o `http://`: usa `https://sensumconstrucciones.com/admin/`. |
| Los correos del panel no llegan | Panel → Correo → **Enviar correo de prueba**. Si falla: revisa servidor, puerto 465/SSL o 587/STARTTLS, usuario (correo completo) y contraseña del buzón `notificaciones@`. Monitoreo → Registro de errores muestra «No se pudo enviar un correo». |
| Los correos llegan a spam | Completa SPF, DKIM y DMARC (paso 6.3). |
| El formulario de contacto no llega | Panel → Correo → **Enviar mensaje de prueba**. Verifica que exista `contacto@` y SPF/DKIM. Si el servidor rechaza el remitente `formulario@`, usa `notificaciones@` como «Correo que envía los mensajes». |
| El visitante ve «No pudimos completar la verificación anti-spam» | Navegador muy antiguo o sin JavaScript: puede escribir por WhatsApp/teléfono (aparecen bajo el formulario). Si le pasa a todos: revisa que `assets/contact-handler.php` y `assets/main.js` sean los del último paquete y que `/home/USUARIO/sensum-rl-data` o `public_html/assets/.rl-data` se puedan escribir. |
| Llega «Alerta de seguridad: cambios en los archivos del sitio» | Si nadie del equipo cambió archivos: cambia la contraseña de cPanel, borra los archivos desconocidos y vuelve a subir el paquete. Si fue un cambio tuyo: Monitoreo → Archivos del sitio → **Marcar como esperados**. |
| Perdí el celular de la verificación en dos pasos | Entra con un **código de recuperación** («Usar un código de recuperación»). Sin códigos: otra persona propietaria no existe, así que usa la Terminal: `php ~/sensum-cms/bin/console 2fa:reset it@gruposensum.com`. A otras personas se la restablece la cuenta propietaria en Seguridad. |
| No llega el respaldo cifrado | Puede ser muy grande para el correo: desactiva «Incluir fotos» (la base de datos sigue incluida) o usa «Descargar respaldo completo». Revisa también la carpeta de spam del correo de destino. |
| Estadísticas en cero o muy bajas | Revisa que estén activadas (Estadísticas → *Estadísticas y privacidad*) y que el sitio se haya publicado después. No se cuentan robots, navegadores con «No rastrear» ni, a veces, quienes usan bloqueadores de anuncios: es lo esperado. |
| Un mensaje del formulario no llegó por correo | Búscalo en **Prospectos** (queda guardado aunque el correo falle; aparece con aviso amarillo). Luego revisa panel → Correo → *Enviar correo de prueba*. |
| Alguien pide que borremos sus datos | Prospectos → abre su mensaje → **Eliminar** (borra mensaje, notas e historial). |
| Monitoreo → Correo y dominio muestra un problema | cPanel → **Email Deliverability** → *Repair* (SPF/DKIM). Para DMARC, paso 6.3. |
| Llegan correos de «Nuevo inicio de sesión» | Es normal la primera vez en cada navegador. Si no fuiste tú: cambia la contraseña y usa «Cerrar sesión en otros dispositivos». |
| «Demasiados píxeles» o falla al subir fotos | Sube `memory_limit` a 256M (paso 4). |
| «El archivo es demasiado grande» | `upload_max_filesize` 16M y `post_max_size` 20M (paso 4). |
| «Última revisión automática: Nunca» | El cron no corre: revisa la ruta de PHP y el comando (paso 16). |
| Nadie ve «Usuarios» | Falta la cuenta propietaria o `OWNER_EMAIL` no coincide con su correo (paso 11). |

Registro técnico: `sensum-cms/storage/logs/app-AAAA-MM.log` y, en el panel,
**Monitoreo → Registro de errores**.
