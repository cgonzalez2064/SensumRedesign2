# Guía de despliegue en Namecheap (Stellar Plus + cPanel)

Paso a paso para poner en línea el sitio de **sensumconstrucciones.com** con el
Administrador de contenido: archivos, base de datos, correo (formulario de
contacto, alertas, informes), cuenta propietaria, usuarios, fotos, tareas
programadas y verificación final.

Tiempo estimado: 1 a 2 horas la primera vez. No necesitas conocimientos de
programación; sí acceso a **cPanel** y a la cuenta de **Namecheap**.

> **Nunca envíes contraseñas por correo ni por chat** (tampoco a soporte). Las
> contraseñas y claves solo se escriben en el archivo `.env` del servidor (paso 9)
> y en un gestor de contraseñas.

---

## 0. Cómo queda todo en el servidor

```
/home/USUARIO/                      ← tu carpeta en el hosting (USUARIO = usuario de cPanel)
├── public_html/                    ← lo que ve el público (sitio web)
│   ├── index.html, 404.html, privacy-notice.html   ← páginas (las regenera el panel)
│   ├── assets/                     ← estilos, scripts, imágenes del diseño
│   │   ├── contact-handler.php     ← formulario de contacto (envía con mail() de PHP)
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
usar el comando de respaldo del paso 15).

---

## 1. Lo que necesitas reunir antes de empezar

| Qué | Dónde se obtiene | Para qué |
|---|---|---|
| Acceso a cPanel | Namecheap → Dashboard → Hosting List → **Go to cPanel** | Todo el proceso |
| Usuario de cPanel (aparece arriba a la derecha en cPanel) | cPanel | Rutas como `/home/USUARIO/` |
| Nombre del servidor de correo | cPanel → Email Accounts → **Connect Devices** (o el correo de bienvenida de Namecheap, sección *Account Information*) | `SMTP_HOST` |
| Contraseña nueva para `no-reply@sensumconstrucciones.com` | La creas en el paso 6 (usa un gestor de contraseñas) | Envío de correos del panel |
| Buzón que recibe el formulario de contacto | Hoy: `contacto@sensumconstrucciones.com` | Que los mensajes de clientes lleguen |
| Correo de soporte | `it@gruposensum.com` | Reportes, alertas, recordatorios y cuenta propietaria |
| (Opcional) Clave de DeepL API Free | https://www.deepl.com/pro-api | Traducción automática ES ⇄ EN |
| (Opcional) Clave de Google PageSpeed | Google Cloud Console (paso 17) | «Visibilidad en Google» del informe mensual |
| (Opcional) Cuenta gratuita de Better Stack | https://betterstack.com | Aviso si el sitio deja de responder |

El dominio debe apuntar al hosting de Namecheap (DNS de Namecheap hosting), o el
certificado HTTPS no se podrá emitir.

---

## 2. Respaldar el sitio actual

1. cPanel → **File Manager** → abre `public_html`.
2. Selecciona todo → **Compress** → *Zip Archive* → descarga el zip a tu computadora.
3. Opcional y recomendado: cPanel → **Backup** → *Download a Full Account Backup*.

Si algo sale mal, con ese zip vuelves al sitio anterior en minutos (paso 21).

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
> base de datos local). En producción se vuelven a subir desde el panel (paso 14).

---

## 4. Configurar PHP en cPanel

cPanel → **Select PHP Version** (sección *Exclusive for Namecheap Customers* o
*Software*):

1. **Current PHP version:** 8.2 u 8.3 → *Apply*.
2. Pestaña **Extensions**: marca `pdo_sqlite`, `sqlite3`, `gd`, `fileinfo`,
   `mbstring`, `exif`, `intl`, `curl`, `openssl`, `json` (algunas ya vienen marcadas).
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

El sitio envía correos de dos formas distintas:

| Qué envía | Cómo | Desde | Hacia |
|---|---|---|---|
| **Formulario de contacto** del sitio público | función `mail()` de PHP del hosting | `no-reply@sensumconstrucciones.com` | `contacto@sensumconstrucciones.com` |
| **Panel**: invitaciones, contraseñas, «Reportar un problema», alertas de errores críticos, informe mensual, recordatorios | SMTP con usuario y contraseña (PHPMailer) | `no-reply@sensumconstrucciones.com` | Según el caso (soporte: `it@gruposensum.com`) |

### 6.1 Crear el buzón que envía: `no-reply@sensumconstrucciones.com`

1. cPanel → **Email Accounts** → **+ Create**.
2. Usuario: `no-reply`, dominio `sensumconstrucciones.com`, contraseña larga generada
   (guárdala en tu gestor de contraseñas).
3. En la lista, junto al buzón, clic en **Connect Devices** → *Mail Client Manual
   Settings*. Anota:
   - **Outgoing Server** (servidor SMTP). Suele ser `mail.sensumconstrucciones.com`
     o el nombre del servidor (por ejemplo `server123.web-hosting.com`). Si el
     certificado del correo no coincide con tu dominio, usa el nombre del servidor.
   - **SMTP Port:** `465` (SSL). Alternativa: `587` (TLS).

### 6.2 El buzón que recibe el formulario: `contacto@sensumconstrucciones.com`

- Si ya existe (en este hosting u otro proveedor), no hay nada que hacer.
- Si no existe: créalo en **Email Accounts**, o crea un **Forwarder** (cPanel →
  Forwarders) para reenviarlo a quien atienda a los clientes.
- Si algún día quieres otro destino, cambia `TO_EMAIL` en
  `public_html/assets/contact-handler.php` (línea 33).

### 6.3 Que los correos no caigan en spam (muy importante)

cPanel → **Email Deliverability** → `sensumconstrucciones.com`:

1. **SPF** y **DKIM**: si aparecen como *Problems Exist*, pulsa **Repair** / **Install
   the suggested record**.
2. **DMARC** (cPanel → Zone Editor → *+ Add Record* → TXT):
   - Nombre: `_dmarc.sensumconstrucciones.com`
   - Valor: `v=DMARC1; p=quarantine; rua=mailto:it@gruposensum.com`
3. Espera de 15 minutos a unas horas a que se propague.

`it@gruposensum.com` es de otro dominio: pide a quien administra ese correo que
**acepte o marque como seguro** a `no-reply@sensumconstrucciones.com`.

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

# --- Correo (valores del paso 6.1) ---
MAIL_DRIVER=smtp
SMTP_HOST=<servidor de Connect Devices, ej. mail.sensumconstrucciones.com>
SMTP_PORT=465
SMTP_ENCRYPTION=ssl
SMTP_USERNAME=no-reply@sensumconstrucciones.com
SMTP_PASSWORD=<contraseña del buzón no-reply>
SMTP_FROM_ADDRESS=no-reply@sensumconstrucciones.com
SMTP_FROM_NAME="Sensum Construcciones"
SMTP_TIMEOUT=15

# --- Soporte y alertas ---
SUPPORT_EMAIL=it@gruposensum.com
ALERTS_ENABLED=true
ALERT_EMAIL=it@gruposensum.com
ALERT_COOLDOWN_MINUTES=60
ALERT_DAILY_MAX=20

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

Guarda y pon el permiso del archivo en **600**. Si usas el puerto 587, cambia
`SMTP_PORT=587` y `SMTP_ENCRYPTION=tls`.

Comprueba la instalación: abre `https://sensumconstrucciones.com/api/health`. Debe
mostrar `"status":"ok"`. (Si dice `service_unavailable`, revisa el paso 5.)

---

## 10. Activar la Terminal de cPanel (una sola vez)

Los pasos 11, 12 y 15 son más fáciles con la Terminal:

1. cPanel → **Manage Shell** (sección *Exclusive for Namecheap Customers*) →
   activa **SSH Access**.
2. Aparece **Terminal** en la sección *Advanced* de cPanel. Ábrela.
3. Averigua la ruta exacta de PHP (la usarás en el paso 15):
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

Entra a `https://sensumconstrucciones.com/admin/` con esa cuenta.

---

## 12. Primera publicación

En el panel → **Inicio**: si aparece «El sitio publicado no coincide…», pulsa
**Volver a publicar el sitio**. O en la Terminal:

```bash
php ~/sensum-cms/bin/console publish
```

---

## 13. Crear los usuarios del equipo

Solo la cuenta propietaria puede crear y modificar usuarios.

1. Panel → **Usuarios** → **Invitar usuario**.
2. Nombre, correo y **Tipo de acceso**:

| Tipo de acceso | Puede cambiar |
|---|---|
| Acceso completo al contenido | Textos, datos de contacto, fotos, portafolio y estado del sitio (actividad y volver a publicar) |
| Editor de contenido | Textos, datos de contacto, fotos y portafolio |
| Solo textos | Los textos del sitio (español e inglés) |
| Solo fotos y portafolio | Fotos de «Nosotros» y proyectos, y el PDF |
| Solo datos de contacto | Teléfonos, WhatsApp, correo, dirección, mapa, Instagram |
| Personalizado | La combinación que elijas |

3. La persona recibe un correo para crear su contraseña (vence en 72 horas). Si el
   correo no sale, el panel te muestra el enlace para compartirlo por otro medio.
4. Para cambiar el acceso después: menú «⋮» de la persona → **Cambiar tipo de
   acceso**. Se aplica de inmediato.

---

## 14. Cargar las fotografías

Las fotos se suben desde el panel → **Fotos y archivos** (pestañas *Nosotros*,
*Tipos de proyectos*, *Documentos*). Quedan en `public_html/assets/uploads/`.

La selección que hicimos con las fotos de Google Drive está anotada en tu
computadora en `cms/storage/photo-selection-2026-10-07.tsv` (foto, lugar y
descripciones en español e inglés): úsala como lista para subir las mismas fotos
en producción.

---

## 15. Tareas programadas (Cron Jobs)

cPanel → **Cron Jobs**. En *Cron Email* puedes dejar `it@gruposensum.com` (solo
escribe si hay algún error). Agrega dos tareas, usando la ruta de PHP del paso 10:

| Tarea | Frecuencia (Common Settings) | Comando |
|---|---|---|
| **Revisión automática** (monitoreo, alertas pendientes, calificación de Google, certificado, recordatorio del informe, limpieza) | *Twice Per Hour* o personalizado `*/15 * * * *` | `/usr/local/bin/php /home/USUARIO/sensum-cms/bin/console monitor > /dev/null 2>&1` |
| **Respaldo diario** de la base de datos (guarda las últimas 14 copias) | *Once Per Day* | `/usr/local/bin/php /home/USUARIO/sensum-cms/bin/console backup > /dev/null 2>&1` |

Reemplaza `/usr/local/bin/php` por la ruta que mostró `which php` y `USUARIO` por tu
usuario de cPanel. En el panel → **Monitoreo**, «Última revisión automática» debe
mostrar la hora de la última ejecución después de unos minutos.

---

## 16. Monitoreo externo (recomendado, gratis)

El panel no puede avisarte si el servidor completo se cae. Para eso:

1. Crea una cuenta gratuita en **Better Stack** (o UptimeRobot).
2. Monitor 1: `https://sensumconstrucciones.com` (estado HTTP 200, alerta de vencimiento SSL).
3. Monitor 2: `https://sensumconstrucciones.com/api/health` (debe contener `"status":"ok"`).
4. Alertas a `it@gruposensum.com`.

---

## 17. Informe mensual para clientes

1. Panel → **Informe mensual** (solo la cuenta propietaria).
2. **Destinatarios:** agrega los correos de tus clientes (máximo 20) → *Guardar
   destinatarios*. La cuenta propietaria va siempre en copia.
3. **Enviarme una prueba** para verlo en tu correo; luego **Enviar informe de {mes}**.
4. Si el informe del mes anterior no se envía en los **primeros 5 días del mes**, la
   cuenta propietaria recibe un **recordatorio** por correo (una vez por mes).

Para que el informe muestre **«Visibilidad en Google»** (calificaciones de 0 a 100):

1. Entra a https://console.cloud.google.com con una cuenta de Google de la empresa.
2. Crea un proyecto (por ejemplo «Sensum sitio web»).
3. *APIs & Services* → *Library* → busca **PageSpeed Insights API** → **Enable**.
4. *APIs & Services* → *Credentials* → **Create credentials → API key**. En
   *API restrictions* limita la clave a **PageSpeed Insights API**.
5. Pega la clave en `.env` → `PAGESPEED_API_KEY=…`. No requiere tarjeta para el
   uso de este sitio. La revisión automática actualiza las calificaciones una vez al día.

---

## 18. Traducción automática (opcional)

1. Crea una cuenta **DeepL API Free** en https://www.deepl.com/pro-api (el plan API,
   no la app). Copia la clave (termina en `:fx`).
2. Pégala en `.env` → `DEEPL_API_KEY=…`.
3. Compruébalo: `php ~/sensum-cms/bin/console translate:test`.

---

## 19. Verificación final

- [ ] `https://sensumconstrucciones.com` se ve igual que antes, en celular y computadora; el botón EN funciona.
- [ ] `https://sensumconstrucciones.com/api/health` → `"status":"ok"`.
- [ ] **Formulario de contacto:** envía un mensaje de prueba desde el sitio → llega a `contacto@sensumconstrucciones.com`.
- [ ] **Correo del panel:** en la Terminal `php ~/sensum-cms/bin/console mail:test it@gruposensum.com` → llega.
- [ ] Inicias sesión en `/admin/` como it@gruposensum.com; ves Usuarios, Monitoreo e Informe mensual.
- [ ] **Reportar un problema** (botón arriba en el panel) → llega a it@gruposensum.com con el nuevo diseño.
- [ ] **Monitoreo → Enviar correo de prueba** → llega la alerta de prueba.
- [ ] **Informe mensual → Enviarme una prueba** → llega.
- [ ] Invitas a una persona con «Solo textos» → solo ve «Textos del sitio».
- [ ] Cambias un texto, lo ves en el sitio (recarga con Ctrl+F5) y lo restauras.
- [ ] Subes una foto de proyecto y aparece en la tarjeta.
- [ ] Monitoreo → «Última revisión automática» muestra una hora reciente (cron funcionando).
- [ ] Better Stack muestra ambos monitores en verde.

---

## 20. Publicar actualizaciones más adelante

1. Respalda (paso 2) y ejecuta `php ~/sensum-cms/bin/console backup`.
2. Genera el nuevo paquete (paso 3) y súbelo/extráelo en `/home/USUARIO`.
3. Reemplaza los archivos **sin borrar**: `sensum-cms/.env`, `sensum-cms/storage/` y
   `public_html/assets/uploads/` (ahí están tu configuración, la base de datos y las fotos).
4. Panel → **Volver a publicar el sitio** (o `bin/console publish`). Las
   actualizaciones de la base de datos se aplican solas.

**Alternativa con Git (cPanel → Git Version Control):** cPanel puede clonar el
repositorio de GitHub y desplegarlo con un archivo `.cpanel.yml`, pero entonces
necesitas Composer en el servidor para instalar PHPMailer (en Namecheap compruébalo
con `composer -V` en la Terminal) y un `.cpanel.yml` que copie solo las carpetas
correctas. El paquete zip de esta guía es más simple y no depende de eso.

---

## 21. Volver atrás (si algo sale mal)

- **Solo el sitio público:** sube y extrae el zip del paso 2 en `public_html`.
- **La base de datos:** reemplaza `sensum-cms/storage/database.sqlite` por una copia
  de `sensum-cms/storage/backups/db/`.
- **Las páginas publicadas:** hay copias automáticas en
  `sensum-cms/storage/backups/published/` (las últimas 30 publicaciones): copia los
  archivos de la carpeta de la fecha que quieras a `public_html`.

---

## 22. Solución de problemas

| Síntoma | Causa probable y solución |
|---|---|
| `/api/health` dice `service_unavailable` | Falta `sensum-cms/vendor` o la carpeta no está junto a `public_html`. Revisa el paso 5. |
| No puedes iniciar sesión (te regresa al inicio) | Falta HTTPS (paso 8) o `APP_URL` no es exactamente `https://sensumconstrucciones.com`. |
| «No pudimos verificar la solicitud por seguridad» | Entraste por `www.` o `http://`: usa `https://sensumconstrucciones.com/admin/`. |
| Los correos del panel no llegan | `php ~/sensum-cms/bin/console mail:test it@gruposensum.com`. Si falla: revisa `SMTP_HOST`, puerto 465/ssl o 587/tls, usuario y contraseña. Monitoreo → Registro de errores muestra «No se pudo enviar un correo». |
| Los correos llegan a spam | Completa SPF, DKIM y DMARC (paso 6.3). |
| El formulario de contacto no llega | Verifica que exista `contacto@sensumconstrucciones.com` (o el reenvío) y SPF/DKIM. |
| «Demasiados píxeles» o falla al subir fotos | Sube `memory_limit` a 256M (paso 4). |
| «El archivo es demasiado grande» | `upload_max_filesize` 16M y `post_max_size` 20M (paso 4). |
| «Última revisión automática: Nunca» | El cron no corre: revisa la ruta de PHP y el comando (paso 15). |
| Nadie ve «Usuarios» | Falta la cuenta propietaria o `OWNER_EMAIL` no coincide con su correo (paso 11). |

Registro técnico: `sensum-cms/storage/logs/app-AAAA-MM.log` y, en el panel,
**Monitoreo → Registro de errores**.
