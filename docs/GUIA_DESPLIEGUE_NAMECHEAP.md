# Guía de despliegue en Namecheap (Stellar Plus + cPanel)

Paso a paso para poner en línea el sitio de **sensumconstrucciones.com** con el
Administrador de contenido: archivos, base de datos, correo (formulario de
contacto, alertas, informes), cuenta propietaria, usuarios, fotos, tareas
programadas y verificación final.

| Dirección | Qué es |
|---|---|
| **https://sensumconstrucciones.com** | El sitio web público |
| **https://app.sensumconstrucciones.com** | El Administrador de contenido (abre el panel) |

Tiempo estimado: 1 a 2 horas la primera vez. No necesitas conocimientos de
programación; sí acceso a **cPanel** y a la cuenta de **Namecheap**.

> **Nunca envíes contraseñas por correo ni por chat** (tampoco a soporte). Las
> contraseñas y claves solo se escriben en el panel (**Administración → Correo**, donde
> se guardan cifradas), en el archivo `.env` del servidor (paso 9) y en un gestor de
> contraseñas.

**Novedad:** el panel vive en su propio subdominio, **app.sensumconstrucciones.com**
(paso 8.1). El correo (cuenta de envío, formulario de contacto, destino de reportes y
alertas) y el captcha del formulario **se configuran desde el panel**, no en archivos.

---

## 0. Cómo queda todo en el servidor

```
/home/USUARIO/                      ← tu carpeta en el hosting (USUARIO = usuario de cPanel)
├── public_html/                    ← lo que ve el público (sitio web)
│   ├── index.html, 404.html, privacy-notice.html   ← páginas (las regenera el panel)
│   ├── assets/                     ← estilos, scripts, imágenes del diseño
│   │   ├── contact-handler.php     ← formulario de contacto (captcha + envío según el panel)
│   │   └── uploads/                ← FOTOS y PDF que se suben desde el panel
│   ├── admin/                      ← el panel (se abre en https://app.sensumconstrucciones.com)
│   └── api/index.php               ← única puerta de entrada al panel
└── sensum-cms/                     ← PRIVADO (fuera de public_html; nadie lo ve desde internet)
    ├── .env                        ← configuración y contraseñas (lo creas tú, paso 9)
    ├── src/, vendor/, templates/…  ← el programa
    └── storage/                    ← base de datos, registros, respaldos, capturas de solicitudes de soporte
        ├── database.sqlite         ← LA base de datos (se crea sola)
        ├── logs/                   ← registro técnico
        ├── backups/                ← copias de la base de datos y de las páginas
        └── reports/                ← capturas de pantalla de «Solicitar soporte»
```

**Un solo `public_html` para los dos dominios.** El subdominio
`app.sensumconstrucciones.com` se crea **compartiendo** la carpeta `public_html`
(paso 8.1), así que no hay archivos que copiar dos veces. El `.htaccess` del paquete
decide qué muestra cada dirección:

| Si visitas… | Ves |
|---|---|
| `https://sensumconstrucciones.com` | El sitio público. `…/admin` te lleva al panel en `app.` |
| `https://app.sensumconstrucciones.com` | El panel (va directo a `/admin/`). Las páginas públicas te devuelven al sitio |
| `http://…`, `www.…` o cualquier otro nombre | Se redirige a la dirección correcta con `https://` |

En el dominio público la API solo atiende lo que usan las páginas (estadísticas, avisos
de errores y `/api/health`); iniciar sesión y todo lo del panel solo funciona en `app.`.

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

El dominio debe apuntar al hosting de Namecheap, o el certificado HTTPS no se podrá
emitir. En Namecheap → **Domain List** → *Manage* → **Nameservers** debe decir
**Namecheap Web Hosting DNS** (así el subdominio `app.` se crea solo en el DNS). Si dice
otra cosa, revisa el paso 8.2.

> En esta guía, **USUARIO** es tu usuario de cPanel (aparece arriba a la derecha en
> cPanel y en las rutas `/home/USUARIO/`). No lo publiques ni lo compartas: es la mitad
> de tu acceso a cPanel.

---

## 2. Respaldar el sitio actual

1. cPanel → **File Manager** → abre `public_html` (activa *Settings → Show Hidden
   Files (dotfiles)* para ver también `.htaccess`).
2. Selecciona todo → **Compress** → *Zip Archive* → nombre `sitio-anterior-AAAA-MM-DD.zip`
   → descarga el zip a tu computadora y ábrelo una vez para comprobar que tiene los archivos.
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

1. **Versión de PHP: 8.4** (o 8.3). El sistema está probado en 8.2 y 8.5; 8.2 deja de
   recibir parches de seguridad el 31 de diciembre de 2026.
   - **Si la cuenta tiene otros sitios**, no cambies *Account Global Settings*: eso cambia
     la versión de **todos** los sitios de la cuenta. Usa la pestaña **Per Domain
     Settings** y elige la versión solo para `sensumconstrucciones.com` (y
     `app.sensumconstrucciones.com` si aparece; comparten carpeta).
   - **Hazlo después de subir el paquete (paso 5)**: cPanel puede escribir la versión
     en `public_html/.htaccess`, y subir el `.htaccess` del paquete la borraría.
     Repítelo también después de cada actualización (paso 22) y comprueba con
     `/api/health`.
2. Pestaña **Extensions** (de esa versión): marca `pdo_sqlite`, `sqlite3`, `gd`,
   `fileinfo`, `mbstring`, `exif`, `intl`, `curl`, `openssl`, `json`, `zip` (respaldos
   cifrados), `sodium`, `iconv` y `xmlwriter` (código QR de la verificación en dos
   pasos); algunas ya vienen marcadas. Si falta alguna, `bin/console check` (paso 11)
   la nombra.
3. Pestaña **Options**:

| Opción | Valor |
|---|---|
| `memory_limit` | `256M` (procesar fotos grandes) |
| `upload_max_filesize` | `20M` (fotos de hasta 10 MB y el portafolio PDF de hasta 20 MB) |
| `post_max_size` | `24M` |
| `max_execution_time` | `60` |
| `display_errors` | `Off` |
| `log_errors` | `On` |

---

## 5. Subir los archivos

1. cPanel → **File Manager** → ve a tu carpeta principal `/home/USUARIO` (un nivel
   **arriba** de `public_html`). Activa *Settings → Show Hidden Files (dotfiles)*.
2. **Antes de tocar nada, revisa que `public_html` sea solo de este sitio.** cPanel →
   **Domains** → columna *Document Root*: si otro dominio de la cuenta (que no sea
   `sensumconstrucciones.com` ni `app.`) dice `/public_html/algo`, su sitio vive dentro
   de esta carpeta y el `.htaccess` nuevo lo afectaría (lo mandaría a este sitio y le
   aplicaría sus reglas de seguridad). Cámbialo primero a una carpeta propia
   (*Manage* → *Document Root*, por ejemplo `/home/USUARIO/ese-dominio.com`, moviendo
   su carpeta ahí) y no la muevas con el resto. Desde la Terminal lo ves de una vez
   (si no imprime nada, no hay ninguno):
   ```bash
   uapi DomainInfo domains_data | grep "documentroot: $HOME/public_html/"
   ```
3. **Saca el sitio anterior de `public_html`** (sin borrarlo): crea la carpeta
   `/home/USUARIO/sitio-anterior` → en `public_html` selecciona todo **excepto**
   `.well-known` y `cgi-bin` (los usa el certificado) → **Move** →
   `/home/USUARIO/sitio-anterior`. Así no quedan archivos viejos (sobre todo `.php`) que
   la revisión de archivos del panel marcaría como sospechosos, y fuera de `public_html`
   nadie los ve desde internet. Para volver atrás, se mueven de regreso (paso 23).
   Bórrala cuando el sitio nuevo lleve unos días funcionando.
4. **Upload** → sube el zip del paso 3 a `/home/USUARIO` → clic derecho → **Extract**.
5. Mueve la carpeta `release-…/sensum-cms` a `/home/USUARIO/sensum-cms` (junto a
   `public_html`, **nunca dentro**).
6. Mueve **el contenido** de `release-…/public_html` dentro de `/home/USUARIO/public_html`.
7. Comprueba que se copiaron los archivos ocultos: `public_html/.htaccess`,
   `public_html/admin/.htaccess`, `public_html/api/.htaccess`,
   `public_html/assets/uploads/.htaccess`, `sensum-cms/.htaccess`.
8. Borra la carpeta `release-…` vacía y el zip.

No subas nada a otra carpeta para `app.sensumconstrucciones.com`: comparte
`public_html` (paso 8.1).

Comprobación rápida: deben existir `/home/USUARIO/sensum-cms/bootstrap.php`,
`/home/USUARIO/sensum-cms/vendor/autoload.php` y `/home/USUARIO/public_html/api/index.php`.

**Lo mismo con la Terminal (paso 10), más rápido y sin errores de selección.** Sube el
zip a `/home/USUARIO` (nunca a `public_html`: mientras esté ahí, cualquiera podría
descargarlo) y escribe, uno por uno (cambia `release-…` por el nombre del zip):

```bash
cd ~ && unzip -q release-….zip && ls release-…
mv ~/release-…/sensum-cms ~/sensum-cms && chmod 700 ~/sensum-cms/storage
mkdir ~/sitio-anterior && cd ~/public_html && find . -mindepth 1 -maxdepth 1 ! -name .well-known ! -name cgi-bin -exec mv -t ~/sitio-anterior/ {} +
cp -a ~/release-…/public_html/. ~/public_html/ && cd ~ && rm -rf ~/release-… ~/release-….zip
ls -A ~/public_html
```

La última línea debe mostrar `.htaccess`, `.well-known`, `404.html`, `admin`, `api`,
`assets`, `cgi-bin`, `index.html`, `privacy-notice.html`, `robots.txt`,
`site.webmanifest` y `sitemap.xml`. Entre el `mv` del sitio anterior y el `cp` el sitio
queda vacío unos segundos: escríbelos seguidos.

---

## 6. Correo electrónico (lo necesario para que TODO envíe y reciba)

Todo se configura después desde el panel (**Administración → Correo**, paso 13). Aquí
solo creas los correos en cPanel.

| Qué envía | Desde (remitente) | Hacia | Respuestas van a |
|---|---|---|---|
| **Formulario de contacto** del sitio | `formulario@sensumconstrucciones.com` | `contacto@sensumconstrucciones.com` | Al visitante (responder = escribirle al cliente) |
| **Panel**: invitaciones, correo de bienvenida, contraseñas, «Solicitar soporte», informe mensual, recordatorios | `notificaciones@sensumconstrucciones.com` | Según el caso | `soporte@sensumconstrucciones.com` |
| **Alertas automáticas** y errores críticos | `notificaciones@sensumconstrucciones.com` | `it@gruposensum.com` | `soporte@sensumconstrucciones.com` |

### 6.1 Correos recomendados para `@sensumconstrucciones.com`

cPanel → **Email Accounts** (buzones) y cPanel → **Forwarders** (reenvíos):

| Correo | Crear como | Para qué | Dónde se usa en el panel |
|---|---|---|---|
| `contacto@` | **Buzón** (si ya existe, déjalo) | Recibe los mensajes del formulario y lo que escriben los clientes. Lo atiende ventas / atención al cliente. | Correo → «Recibe los mensajes» |
| `notificaciones@` | **Buzón** con contraseña larga | **Cuenta de envío** del panel (SMTP). Envía invitaciones, correos de bienvenida, contraseñas, solicitudes de soporte, informe mensual, alertas y, con el método recomendado, también el formulario. | Correo → Cuenta de envío del panel |
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
2. **DMARC** (cPanel → Zone Editor → TXT `_dmarc.sensumconstrucciones.com`):
   - Si ya existe (por ejemplo `v=DMARC1; p=none;`), **edítalo**; no agregues otro: dos
     registros DMARC hacen que ninguno valga.
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

## 8. Dominios y HTTPS (sitio y panel)

### 8.1 Crear el subdominio del panel: `app.sensumconstrucciones.com`

cPanel → **Domains** → **Create A New Domain**:

| Campo | Valor |
|---|---|
| Tipo | **Registered Domain** (no *Temporary Domain*) |
| Domain | `app.sensumconstrucciones.com` |
| **Share document root (/home/USUARIO/public_html) with “sensumconstrucciones.com”** | ✅ **Márcala** |
| Document Root | Al marcar la casilla queda `public_html` (no escribas otra carpeta) |

Pulsa **Submit**. En la lista de **Domains**, `app.sensumconstrucciones.com` debe decir
*Document Root* `/public_html`.

> **Por qué compartir `public_html`:** el panel, su API y las fotos viven en esa
> carpeta junto al sitio; el `.htaccess` del paquete hace que `app.` muestre solo el
> panel y que el dominio principal muestre solo el sitio. Así no hay copias, ni enlaces
> entre carpetas, ni nada que actualizar dos veces.
>
> cPanel advierte que **la opción es permanente**: si algún día quisieras otra carpeta,
> se borra el subdominio (Domains → *Manage* → *Remove Domain*) y se vuelve a crear.
> Si ya lo creaste **sin** marcarla, haz eso ahora: bórralo, borra la carpeta
> `/home/USUARIO/app.sensumconstrucciones.com` que se creó vacía, y créalo de nuevo
> marcándola.

### 8.2 DNS del subdominio

- Con **Namecheap Web Hosting DNS** (lo normal): cPanel crea solo el registro `app`
  (no lo agregues a mano: ya existe aunque no lo veas al principio de la lista).
  Compruébalo en cPanel → **Zone Editor** → `sensumconstrucciones.com` → *Manage*:
  debe existir un registro **A** `app.sensumconstrucciones.com` con la misma IP que
  `sensumconstrucciones.com`.
- Con **otros DNS** (Namecheap BasicDNS, Cloudflare…): crea allí un registro **A** con
  host `app` y la IP del hosting (cPanel → barra lateral *General Information* →
  **Shared IP Address**). Si usas Cloudflare, déjalo en *DNS only* (nube gris) hasta
  que el certificado esté emitido.

Puede tardar de minutos a unas horas en propagarse.

### 8.3 Certificado HTTPS: uno solo para los tres nombres (Let's Encrypt, gratis)

Al compartir `public_html`, cPanel crea `app.` como **alias** del dominio principal:
los dos son el mismo sitio en el servidor y usan **un solo certificado**, que debe cubrir
`sensumconstrucciones.com`, `www.sensumconstrucciones.com` **y**
`app.sensumconstrucciones.com`. Si instalas uno que cubra solo `app.`, el dominio
principal se queda sin certificado (y al revés).

- **Namecheap no usa AutoSSL.** **SSL/TLS Status** muestra `app.` (y `mail.app.`,
  `www.app.`) con «*…will not renew via AutoSSL because it was not issued via
  AutoSSL*»: ignóralo y **no pulses *Run AutoSSL***.
- El certificado gratis de Namecheap (complemento **Namecheap SSL**) cubre un solo
  nombre, no se puede usar con alias y su renovación se paga. Por eso `app.` no aparece
  en ese complemento: es normal.
- **Let's Encrypt** sí sirve: gratis, cubre los tres nombres, dura 90 días y **se renueva
  e instala solo** cada 60. Se hace una vez desde la Terminal (paso 10; actívala ya si
  aún no lo hiciste). Escribe los comandos **uno por uno**.

1. Instala acme.sh en tu carpeta privada (no en `public_html`):
   ```bash
   cd ~ && git clone --depth 1 https://github.com/acmesh-official/acme.sh.git acme-src
   cd ~/acme-src && ./acme.sh --install -m it@gruposensum.com
   cd ~ && rm -rf ~/acme-src
   ```
   (Si dice `git: command not found`: `curl https://get.acme.sh | sh -s email=it@gruposensum.com`.)
2. Usa Let's Encrypt (por omisión usaría otra autoridad, ZeroSSL):
   ```bash
   ~/.acme.sh/acme.sh --set-default-ca --server letsencrypt
   ```
3. Emite **un** certificado para los tres nombres (los comprueba con archivos temporales
   en `public_html/.well-known/acme-challenge/`):
   ```bash
   ~/.acme.sh/acme.sh --issue -d sensumconstrucciones.com -d www.sensumconstrucciones.com -d app.sensumconstrucciones.com -w ~/public_html --keylength 2048
   ```
   Debe terminar en **Cert success**.
4. Revisa que sea el único certificado de este dominio en acme.sh:
   ```bash
   ~/.acme.sh/acme.sh --list
   ```
   Debe haber **una sola** línea de `sensumconstrucciones.com` (KeyLength `"2048"`,
   *SAN_Domains* con `www.` y `app.`, CA `LetsEncrypt.org`). Si hay otras de este dominio
   (por ejemplo una vieja `"ec-256"` de ZeroSSL, o una de `app.` sola), quítalas antes de
   seguir: al renovarse instalarían un certificado que no cubre los tres nombres, y si
   existe una `ec-256` el paso siguiente la elegiría en lugar de la nueva:
   ```bash
   ~/.acme.sh/acme.sh --remove -d sensumconstrucciones.com --ecc
   mv ~/.acme.sh/sensumconstrucciones.com_ecc ~/acme-anterior-sensum-ecc
   ```
   (para la de `app.` sola: `~/.acme.sh/acme.sh --remove -d app.sensumconstrucciones.com`).
   No toques las líneas de otros dominios.
5. Instálalo (con el dominio principal primero: así cubre también su alias `app.`):
   ```bash
   ~/.acme.sh/acme.sh --deploy -d sensumconstrucciones.com --deploy-hook cpanel_uapi
   ```
   Debe terminar en **Successfully deployed certificate to 2 of 2 sites via UAPI** y
   **Success** (los dos «sitios» son el dominio principal y su alias `app.`). Los
   mensajes intermedios de Namecheap (`NcCustomHooks`, `hc_agent.token: no such file`)
   son de un aviso interno de su complemento y no afectan la instalación. El servidor lo
   aplica en unos minutos: un nombre puede seguir mostrando el certificado anterior un
   rato.
6. Renovación automática: `crontab -l | grep acme` debe mostrar una línea con
   `acme.sh --cron`. Si no aparece, créala en cPanel → **Cron Jobs** (*Once Per Day*):
   `/home/USUARIO/.acme.sh/acme.sh --cron --home /home/USUARIO/.acme.sh > /dev/null`.
   Cada renovación vuelve a instalarlo sola.
7. Abre `https://sensumconstrucciones.com`, `https://www.sensumconstrucciones.com` y
   `https://app.sensumconstrucciones.com`: candado en los tres (emisor *Let's Encrypt*).

**Si algo falla, el sitio público no puede quedarse sin certificado:** cPanel → **SSL/TLS**
→ **Manage SSL sites** → `sensumconstrucciones.com` → **Browse Certificates** → el
certificado anterior → **Install Certificate**. Luego revisa el mensaje de error del paso
que falló.

- En **Namecheap SSL**, no pulses *Install* ni *Reorder* para `sensumconstrucciones.com`:
  reemplazaría el certificado de los tres nombres por uno que no cubre `app.`.
- La clave privada queda en `~/.acme.sh/` (fuera de `public_html`, solo tu usuario la
  lee): **nunca la copies a un chat ni a un correo**.
- `mail.app.` y `www.app.` los crea cPanel con el alias; no se usan y no necesitan
  certificado.

El sitio obliga a usar `https://sensumconstrucciones.com` (sin www) y el panel
`https://app.sensumconstrucciones.com`; el panel solo permite iniciar sesión por HTTPS.
**Ten el certificado listo antes de subir el paquete (paso 5)**: el sitio nuevo pide a
los navegadores usar siempre HTTPS también en los subdominios (HSTS), así que sin
certificado no podrías abrir el panel ni aceptando la advertencia. El `.htaccess` del
paquete deja pasar `/.well-known/` en todos los nombres, así que las renovaciones siguen
funcionando con el sitio nuevo publicado. Como el certificado es el mismo para el sitio y
el panel, el aviso de vencimiento del panel (21, 7 y 1 día antes) cubre los dos.

---

## 9. Crear el archivo de configuración `.env`

File Manager → `/home/USUARIO/sensum-cms/` → **+ File** → nombre `.env` → **Edit**.
Pega esto y reemplaza lo que está entre `< >`:

```ini
# --- Sitio y panel ---
APP_ENV=production
APP_URL=https://sensumconstrucciones.com
ADMIN_URL=https://app.sensumconstrucciones.com/admin
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
# La clave de DeepL ya no hace falta aquí: se pega en el panel (paso 20).
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

`APP_URL` es el sitio público (lo usan «Ver sitio», el informe mensual y las revisiones
de velocidad y dominio). `ADMIN_URL` es la dirección del panel: con ella salen **todos
los enlaces de los correos** (invitaciones, bienvenida, contraseñas, prospectos,
solicitudes de soporte, alertas) y solo desde ella se puede iniciar sesión. Escríbelas
exactamente así: con `https://`, sin `www.` y sin `/` al final.

> **Alternativa (opcional):** si prefieres que el correo no se pueda cambiar desde el
> panel, escribe en `.env` los valores `SMTP_HOST`, `SMTP_PORT`, `SMTP_ENCRYPTION`,
> `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_ADDRESS`, `SMTP_REPLY_TO`,
> `SUPPORT_EMAIL`, `ALERT_EMAIL`, `CONTACT_TO`, `CONTACT_FROM_ADDRESS`,
> `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` y agrega `EMAIL_SETTINGS_LOCKED=true`.
> La página Correo queda en solo lectura.

Comprueba la instalación: abre `https://sensumconstrucciones.com/api/health` y
`https://app.sensumconstrucciones.com/api/health`. Los dos deben mostrar
`"status":"ok"`. (Si dice `service_unavailable`, revisa el paso 5.)

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
   Comprueba la versión con `php -v`. En la Terminal y en las tareas programadas
   `php` usa la versión **de la cuenta**, no la elegida por dominio: si muestra otra
   (por ejemplo 7.4), usa siempre la ruta completa de la versión del sitio, por
   ejemplo `/opt/alt/php84/usr/bin/php` (las disponibles: `ls /opt/alt/`). En los
   pasos 11, 12 y 16 reemplaza `php` por esa ruta.

---

## 11. Crear la cuenta propietaria (it@gruposensum.com)

En la Terminal:

```bash
php ~/sensum-cms/bin/console check
```

Todas las líneas obligatorias deben decir `OK` (las opcionales pueden decir `WARN`).
La línea `https` debe mostrar
`https://sensumconstrucciones.com · panel https://app.sensumconstrucciones.com/admin`.
Después:

```bash
php ~/sensum-cms/bin/console create-admin --name="Soporte IT" --email=it@gruposensum.com
```

Escribe la contraseña dos veces (no se ve al escribir; mínimo 10 caracteres). Debe
responder *«Account created (id 1).»* y *«This is the owner account…»*. Otras respuestas:
*«Passwords do not match»* (vuelve a correr el comando), *«password_too_short»* (menos
de 10 caracteres) o *«email_taken»* (la cuenta ya existe: entra con ella o usa
*¿Olvidaste tu contraseña?* cuando el correo esté configurado).

Hasta configurar el correo (paso 13), los avisos que el panel intenta enviar (por
ejemplo, «verificación en dos pasos activada») no salen y Monitoreo muestra «No se pudo
enviar un correo»: es normal en este orden de pasos.

**Sin Terminal:** agrega al `.env` una línea `SETUP_TOKEN=` con un valor largo
aleatorio (de tu gestor de contraseñas), abre
`https://app.sensumconstrucciones.com/admin/#/configurar`, escribe ese valor, el nombre,
`it@gruposensum.com` y la contraseña. Al terminar, **borra la línea `SETUP_TOKEN`**.

Entra a `https://app.sensumconstrucciones.com` con esa cuenta (te lleva al panel). **La primera vez el
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
| Servidor / Puerto / Seguridad | **El nombre del servidor** que anotaste en el paso 6.1 (por ejemplo `server123.web-hosting.com`), `465`, `SSL`. El botón «Completar con los datos de Namecheap» escribe `mail.sensumconstrucciones.com`: solo funciona si ese nombre tiene su propio certificado. Con el certificado de Let's Encrypt del paso 8.3 (que no incluye `mail.`), el servidor de correo presenta el certificado `*.web-hosting.com` y el envío falla por nombre no coincidente; cámbialo por el nombre del servidor. |
| Usuario | `notificaciones@sensumconstrucciones.com` |
| Contraseña | La del buzón `notificaciones@` (se guarda cifrada; nunca se vuelve a mostrar) |

### 13.2 Formulario de contacto y destinatarios

| Campo | Valor |
|---|---|
| Recibe los mensajes | `contacto@sensumconstrucciones.com` (hasta 3, separados por coma) |
| Correo que envía los mensajes | `formulario@sensumconstrucciones.com` |
| Nombre del remitente | `Sitio web Sensum` |
| Cómo se envía | **Con la cuenta de envío del panel (recomendado)** |
| Solicitudes de soporte | `it@gruposensum.com` |
| Alertas automáticas y errores críticos | `it@gruposensum.com` |

Pulsa **Guardar configuración** y luego **Enviar correo de prueba** y **Enviar mensaje
de prueba**: deben llegar a `it@gruposensum.com` y a `contacto@` (revisa spam).

> **Quién recibe los mensajes** también se puede cambiar desde **Sitio web →
> Formulario de contacto → ¿Quién recibe los mensajes?** (solo la cuenta propietaria,
> con su contraseña; llega un aviso de seguridad). Es el mismo ajuste.

### 13.2b Preguntas del formulario

Panel → **Sitio web → Formulario de contacto**: cambia el texto de cada pregunta,
márcala obligatoria u opcional, ordénalas, agrega preguntas (texto corto, párrafo,
correo, teléfono, número, fecha, lista desplegable, opción única o casillas) y edita
las opciones de «Servicio de interés». El nombre siempre se pide y al menos el correo
o el teléfono queda obligatorio. Las respuestas extra llegan en el correo, quedan en
**Prospectos** y salen en el CSV. Al guardar, el sitio se publica solo.

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
  - **Probarlo antes en tu computadora:** Cloudflare publica claves de prueba que
    funcionan en `localhost` / `127.0.0.1` sin configurar nada: Site Key
    `1x00000000000000000000AA` con Secret Key `1x0000000000000000000000000000000AA`
    (siempre aprueba) o `2x00000000000000000000AB` con
    `2x0000000000000000000000000000000AA` (siempre rechaza). **Nunca** las uses en el
    servidor real: aceptan cualquier respuesta.
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

Crean y modifican usuarios la cuenta propietaria y quienes tienen **Gestión de
usuarios** (incluida en «Administrador del sitio»). Quien no es la cuenta propietaria
solo cambia a personas con igual o menos acceso y que no gestionan usuarios, y solo da
los accesos que tiene; «Gestión de usuarios» solo la da la cuenta propietaria.

1. Panel → **Usuarios** → **Invitar usuario**.
2. Nombre, correo y **Rol**:

| Rol | Para quién | Ve y puede usar |
|---|---|---|
| Administrador | Quien administra el sitio y al equipo (solo lo da la cuenta propietaria) | Textos, datos de contacto y formulario, fotos, portafolio, publicación y actividad, **Prospectos**, **Estadísticas**, **Salud del sitio**, **Informe mensual (consulta)** y **Gestión de usuarios** |
| Editor del sitio web | Quien actualiza el sitio (mercadeo, recepción, fotografía) | Textos, fotos, portafolio en PDF, datos de contacto y formulario |
| Ventas y prospectos | Quien atiende clientes | **Prospectos** (mensajes del formulario) y **Estadísticas** completas; no cambia el sitio |
| Consulta (solo lectura) | Dirección / gerencia | **Estadísticas de visitas** (versión básica, sin datos personales), **Salud del sitio** e **Informe mensual (consulta)**; no cambia nada |

Para una excepción, abre **Secciones adicionales (opcional)** debajo de los roles y agrega
una sección que el rol no incluye (por ejemplo, «Editor del sitio web + Prospectos»).
Las secciones son: Textos del sitio · Datos de contacto y formulario · Fotos · Portafolio
en PDF · Publicación y actividad · Prospectos · **Estadísticas de visitas** · **Salud del
sitio** · **Informe mensual (consulta)** · **Gestión de solicitudes de soporte** (para
quien da soporte técnico) · **Gestión de usuarios** (incluida en Administrador). Cada
persona ve en **Más secciones** las que puede pedir y las pide con un clic; tú las das
en Usuarios → **Solicitudes de acceso**.

Si a alguien no le llegan los correos (por ejemplo, un buzón recién creado), en su menú
«⋮» usa **Establecer contraseña**: el panel genera una fácil de leer, tú se la compartes
por un medio seguro y al entrar crea la suya. También puedes **Actualizar información**
(nombre y correo), **Enviar enlace para nueva contraseña**, exigir su **Verificación en dos
pasos** o **Quitar dispositivos registrados** si perdió o cambió de teléfono (al entrar
confirma un código que le llega por correo y registra el nuevo).

> **Salud del sitio** es la versión resumida del Monitoreo: si el sitio funciona, la
> **disponibilidad (uptime)** de las últimas 24 horas, 7, 30 y 90 días, la gráfica de
> disponibilidad diaria, el tiempo de respuesta, los **incidentes** de los últimos 30
> días (cuándo y cuánto duraron), la cantidad de errores y las fechas del certificado,
> dominio y respaldos. **No** muestra mensajes de error, configuración ni detalles del
> servidor (eso sigue siendo solo de la cuenta propietaria).

> **Estadísticas de visitas** sin **Prospectos** muestra la versión básica: visitas,
> páginas vistas, de dónde llegan, dispositivos y clics para contactar. No muestra
> mensajes del formulario ni datos personales. Con **Prospectos** se ve completa
> (mensajes recibidos, tasa de contacto y el embudo hasta «Ganado»).

> **Prospectos contiene datos personales** de quienes escriben por el formulario: dales
> ese acceso solo a quienes atienden clientes (ventas).

> **Gestión de solicitudes de soporte** permite ver y responder **todas** las
> solicitudes del equipo, cambiar su estado y prioridad, agregar notas internas y ver
> el **Panorama de soporte** (gráficas). Dáselo solo a quien da soporte técnico; las
> demás personas siguen viendo únicamente sus propias solicitudes.

3. La persona recibe un correo para crear su contraseña (vence en 72 horas). Si el
   correo no sale, el panel te muestra el enlace para compartirlo por otro medio.
   Al crear su contraseña recibe un **correo de bienvenida** (una sola vez, en el idioma
   elegido en la invitación) con su rol explicado, los primeros pasos y cómo
   pedir ayuda; y la **primera vez que entra** el panel le pide elegir **idioma** y
   **apariencia** (Claro, Oscuro o Automático, que viene preseleccionado). Las cuentas
   que ya usaban el panel no ven esa pantalla.
4. Para cambiar el acceso después: menú «⋮» de la persona → **Cambiar rol**. Se aplica
   de inmediato.
5. **Buscar personas:** arriba de la lista hay un buscador (nombre, correo o rol; no
   importan tildes ni mayúsculas) y filtros por **estado** y **rol**.
6. **Comprueba lo que ve cada persona con «Ver como…»** (arriba en Usuarios, o en el
   menú «⋮» de cada persona): pide tu contraseña una vez y muestra el panel exactamente
   como lo ve esa cuenta. Una barra azul arriba permite **Cambiar de persona** (sin
   volver a escribir la contraseña) o **Volver a mi cuenta**. Es **solo lectura** (no
   se guarda nada ni se marca nada como leído en su cuenta), queda registrado y termina
   sola a los 30 minutos.

---

> **Cuentas de prueba:** el comando `demo-users` (cuentas `demo.*@example.test`)
> es solo para pruebas en tu computadora y **se niega a funcionar en producción**.
> No lo ejecutes en el servidor; crea las cuentas reales con **Invitar usuario**.

## 15. Cargar las fotografías

Las fotos se suben desde el panel → **Fotos y archivos** (pestañas *Nosotros*,
*Tipos de proyectos*, *Documentos*). Quedan en `public_html/assets/uploads/`.

**Pasar las fotos que ya cargaste en otra instalación (por ejemplo, la de tu
computadora) sin subirlas una por una.** En la computadora, desde la carpeta del proyecto:

```bash
php tools/export-photos.php dist/fotos-sitio-AAAAMMDD && (cd dist && zip -qr fotos-sitio-AAAAMMDD.zip fotos-sitio-AAAAMMDD)
```

El zip trae solo las fotos activas (todos sus tamaños), su orden y sus descripciones en
español e inglés, más el importador `importar-fotos.php`; nada de usuarios, mensajes,
configuración ni claves. Súbelo a `/home/USUARIO` (nunca a `public_html`) y en la Terminal:

```bash
cd ~ && unzip -q fotos-sitio-AAAAMMDD.zip
php ~/fotos-sitio-AAAAMMDD/importar-fotos.php --dry-run
php ~/fotos-sitio-AAAAMMDD/importar-fotos.php
rm -rf ~/fotos-sitio-AAAAMMDD ~/fotos-sitio-AAAAMMDD.zip
```

La simulación (`--dry-run`) muestra qué haría sin cambiar nada. Después debe decir
*«Listo: N fotos importadas y el sitio publicado»*. Solo llena los espacios que están
**vacíos** en el sitio: las fotos que ya subiste en el panel nunca se reemplazan (para
rehacer un espacio, borra sus fotos en el panel y vuelve a correrlo). Copia los archivos
tal cual (sin volver a comprimirlos), revisa la huella SHA-256 de cada uno y, si algo no
cuadra, no cambia nada. Correrlo dos veces no duplica fotos.

La selección original de fotos de Google Drive está anotada en tu computadora en
`cms/storage/photo-selection-2026-10-07.tsv` (foto, lugar y descripciones en español e
inglés).

---

## 16. Tareas programadas (Cron Jobs)

Dos tareas tienen que correr solas en el servidor:

| Tarea | Cuándo | Qué hace |
|---|---|---|
| **Revisión automática** (`bin/console monitor`) | cada 15 minutos | monitoreo, alertas, calificación de Google, certificado, recordatorio del informe, limpieza y las **automatizaciones**: recordatorios de invitaciones, accesos temporales, cuentas sin uso, seguimiento y resumen de prospectos |
| **Respaldo diario** de la base de datos (`bin/console backup`) | todos los días, 03:17 | guarda las últimas 14 copias |

**Instálalas con un comando** en cPanel → **Terminal**:

```bash
php ~/sensum-cms/bin/console cron:install
php ~/sensum-cms/bin/console cron
```

- `cron:install` agrega las dos tareas al cron de tu cuenta, las mismas que luego ves en
  cPanel → **Cron Jobs**. Usa las rutas completas y la misma versión de PHP del panel,
  así que no hace falta buscar la ruta de PHP. No toca las demás tareas (por ejemplo, la
  renovación del certificado `acme.sh` u otros sitios) y antes guarda una copia del cron
  anterior en `sensum-cms/storage/backups/crontab-….txt`. Si ya existían líneas de esta
  guía para el panel, con `USUARIO`, `~/` o la ruta de PHP equivocada, las reemplaza.
  Para ver el cambio antes de hacerlo: `cron:install --dry-run`.
- `cron` revisa que todo esté bien: las dos tareas deben aparecer como `[ OK ]`; también
  muestra la última revisión, el último respaldo y los errores que haya escrito el cron
  (`sensum-cms/storage/logs/cron.log`). Si la revisión no corre 15 minutos después de
  instalarla, ejecútala una vez a mano para ver el error:
  `php ~/sensum-cms/bin/console monitor`.
- En el panel → **Monitoreo**, «Última revisión automática» muestra la hora de la última
  ejecución.

**Sin Terminal:** en cPanel → **Cron Jobs** agrega las dos líneas que muestra
`cron:install` cuando no puede escribir el cron. Son de este tipo, con la ruta que mostró
`which php` y tu usuario de cPanel en lugar de `USUARIO`:

```
*/15 * * * * /usr/local/bin/php /home/USUARIO/sensum-cms/bin/console monitor > /dev/null 2>> /home/USUARIO/sensum-cms/storage/logs/cron.log # sensum-cms
17 3 * * * /usr/local/bin/php /home/USUARIO/sensum-cms/bin/console backup > /dev/null 2>> /home/USUARIO/sensum-cms/storage/logs/cron.log # sensum-cms
```

En *Cron Email* puedes dejar `it@gruposensum.com`: estas tareas no escriben nada en una
ejecución normal, así que no llegan correos del cron.

Sin esta tarea, las automatizaciones (recordatorios por correo, fin de los accesos
temporales por el aviso de 3 días, cuentas sin uso, recordatorios y resumen de
prospectos) no se envían. El fin de un acceso temporal sí se aplica igual: la cuenta
se desactiva en cuanto la persona intenta usar el panel. Para probarlas a mano:
`php ~/sensum-cms/bin/console automations`.

Cada revisión también mide **cuánto tarda en cargar la página de inicio**; con eso se
arma la gráfica «Tiempo de respuesta» de Monitoreo → **Tendencias** (junto con errores
por día e inicios de sesión; 7, 30 o 90 días). Algunos hostings no permiten que el
servidor se visite a sí mismo: si la gráfica dice «Todavía no hay mediciones» después
de un día, no es una falla del sitio (la disponibilidad se mide aparte).

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
| Cuota de traducción automática (DeepL): la clave usó el 90 % de sus caracteres, y cuando se agotan | Revisión cada 6 horas (y al pulsar «Probar conexión»); una vez por clave al 90 % y al 100 % |
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
4. Monitor 3 (opcional): `https://app.sensumconstrucciones.com/api/health` (vigila
   también que el certificado siga cubriendo `app.`, paso 8.3).
5. Alertas a `it@gruposensum.com`.

---

## 17b. Que Google encuentre el sitio (Search Console, Bing y perfil de empresa)

Una vez en línea, registra el sitio en los buscadores. Los pasos completos, con lo que
le toca a quien administra el perfil de Google de la empresa, están en
[`GUIA_SEO.md`](GUIA_SEO.md). Lo mínimo:

1. **Google Search Console** → propiedad de tipo **Dominio** `sensumconstrucciones.com`
   → copia el registro **TXT** que te da Google → cPanel → **Zone Editor** →
   `sensumconstrucciones.com` → **Add Record** (TXT) → **Verificar**.
2. Search Console → **Sitemaps** → `sitemap.xml` → **Enviar**; luego **Inspección de
   URLs** → `https://sensumconstrucciones.com/` → **Solicitar indexación**.
3. **Bing Webmaster Tools** → **Importar desde Google Search Console**.
4. El título y la descripción que muestra Google se cambian en el panel: **Textos del
   sitio → Google (resultados de búsqueda)**. No se ven en la página.

Comprueba que las direcciones del sitio anterior ya no dan error:

```bash
curl -sI https://sensumconstrucciones.com/services.php | grep -i '^location'
```

Debe responder `location: https://sensumconstrucciones.com/#servicios` (lo mismo con
`/about`, `/proyects` y `/contact`, que llevan a su sección).

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
- El **aviso de privacidad** ya está completo, sin marcadores pendientes: describe lo
  que el sitio hace de verdad (formulario, estadísticas sin cookies, protección
  anti-spam, hosting y correo en Namecheap/EE. UU., derechos y plazo de respuesta de 10
  días hábiles) conforme a la legislación de Guatemala. Las partes de estadísticas,
  conservación y Turnstile se actualizan solas con la configuración del panel.
  Recomendado: que asesoría legal lo lea una vez; si cambias de hosting o de correo,
  hay que actualizar la sección 5.

### 18.3 Soporte: tiempo de respuesta, satisfacción y gráficas

- Panel → menú **Soporte** (cuenta propietaria o personas con **Gestión de
  solicitudes de soporte**): arriba está el **Panorama de soporte** con el período
  (30, 90 o 365 días), las solicitudes **abiertas**, **recibidas** y **resueltas**
  (con el tiempo promedio de resolución), la **primera respuesta promedio**, el
  **% dentro del objetivo**, la **satisfacción**, la gráfica **Recibidas y resueltas
  por día** y barras **por estado, tipo, prioridad y dónde se notó**. Se puede plegar.
- En el mismo panorama elige el **Objetivo de respuesta** (recomendado **24 h**; 8 h si
  el contrato lo promete).
- Cuando marcas una solicitud como **resuelta**, la persona puede **calificar de 1 a 5**.
  Una calificación de 1–2 la marca como no leída para que la revises.
- Las solicitudes resueltas sin respuesta se **cierran solas a los 7 días** (tarea programada).

## 19. Informe mensual para clientes

1. Panel → **Informe mensual** (la cuenta propietaria lo envía; los administradores solo lo consultan).
2. **Destinatarios:** agrega los correos de tus clientes (máximo 20) → *Guardar
   destinatarios*. La cuenta propietaria va siempre en copia.
3. **Enviarme una prueba** para verlo en tu correo; luego **Enviar informe de {mes}**.
4. Si el informe del mes anterior no se envía en los **primeros 5 días del mes**, la
   cuenta propietaria recibe un **recordatorio** por correo (una vez por mes).
5. El correo lleva **la versión en PDF adjunta** (lista para imprimir o reenviar) y
   compara cada cifra con el **mes anterior** (▲ verde si mejoró, ▼ rojo si empeoró).
   También puedes **Descargar PDF** desde la página del informe.
6. **Dos versiones del mismo mes** (pestañas en la vista previa):
   - **Para clientes** — es la que se envía por correo y en PDF. Breve, positiva y sin
     términos técnicos: muestra el **valor del soporte**.
     - **Resumen** y cifras clave: **Disponibilidad**, **Visitas**, **Clientes
       potenciales**, **Revisiones automáticas** (cada 15 minutos), **Cambios
       publicados**, **Amenazas detenidas** (accesos indebidos y spam) y **Solicitudes
       resueltas**. Las comparaciones con el mes anterior aparecen **solo cuando
       mejoran**.
     - **Lo más destacado del mes**, **Visitas y clientes potenciales** (de dónde
       llegan, clics, mensajes, proyectos ganados y su monto), **Trabajo realizado**
       (contenido publicado, solicitudes atendidas y resueltas, tiempo de respuesta),
       **Monitoreo y protección** (revisiones automáticas, avisos al instante,
       verificación de archivos, conexión segura, accesos y spam bloqueados, velocidad)
       y **Próximos pasos** para el cliente (por ejemplo, contactar clientes
       potenciales pendientes).
     - **No incluye** respaldos, certificados, dominio, configuración de correo,
       errores, interrupciones detalladas ni pendientes técnicos.
   - **Detalle técnico** (interno, **nunca se envía**): estado **Protegido / Requiere
     atención** con el motivo exacto (sin HTTPS, sin respaldos o respaldo de más de 7
     días, certificado por vencer), interrupciones con fecha, hora y qué falló, errores
     del mes, respaldos, certificado, dominio, SPF/DKIM/DMARC, calificaciones de Google,
     nivel de servicio completo (incluidas solicitudes abiertas y calificaciones),
     mantenimiento automático y **pendientes técnicos**. En una prueba local
     (`http://localhost` o `127.0.0.1`) no se exige HTTPS; en el servidor real sí.
7. **Quién lo ve:** la cuenta propietaria lo prepara y lo envía. Las personas con el
   acceso **Informe mensual (consulta)** —incluido en **Administrador del sitio** y
   **Soporte técnico**— ven las dos versiones en el menú **Estado del sitio → Informe
   mensual**, pero no pueden enviarlo ni cambiar destinatarios.

Para que el informe muestre **«Visibilidad en Google»** (calificaciones de 0 a 100):

1. Entra a https://console.cloud.google.com con una cuenta de Google de la empresa.
2. Crea un proyecto (por ejemplo «Sensum sitio web»).
3. *APIs & Services* → *Library* → busca **PageSpeed Insights API** → **Enable**.
4. *APIs & Services* → *Credentials* → **Create credentials → API key**. En
   *API restrictions* limita la clave a **PageSpeed Insights API**.
5. Pega la clave en `.env` → `PAGESPEED_API_KEY=…`. No requiere tarjeta para el
   uso de este sitio. La revisión automática actualiza las calificaciones una vez al día.

---

## 20. Traducción automática (recomendada)

Con ella, al escribir un texto en español el inglés se llena solo (y al revés) en
**Textos del sitio**, **opciones del formulario de contacto** y **descripciones de
fotos**; la persona lo revisa antes de guardar. Se configura **desde el panel**:

1. Crea una cuenta gratuita de **DeepL API** en https://www.deepl.com/pro-api (el plan
   API, no la app; pide tarjeta solo para verificar, no cobra). En *API Keys* copia la
   clave. El plan gratuito actual para desarrolladores incluye **1,000,000 de
   caracteres en total** (no se renueva; las claves «API Free» anteriores tienen 500,000
   al mes). Todos los textos del sitio suman unos 5,000 caracteres, así que alcanza
   para años de ediciones normales.

   > **El botón ES/EN del sitio no usa DeepL.** Los dos idiomas quedan guardados y
   > publicados en la página; el cambio ocurre en el navegador del visitante. DeepL
   > solo propone el inglés en el panel mientras alguien escribe (se revisa y se
   > guarda). Si el plan se acaba, el panel deja de llenarlo solo, el inglés se
   > escribe a mano y el sitio sigue funcionando igual.
2. Panel → **Administración → Traducción**: pega la clave, deja activado **Usar
   traducción automática**, **Guardar cambios** (pide tu contraseña).
3. **Probar conexión**: debe decir «La clave funciona (DeepL API Free)» con el
   consumo del mes.

La clave se guarda cifrada y nunca se vuelve a mostrar. Si ya estaba en `.env`
(`DEEPL_API_KEY`), sigue funcionando; la del panel tiene prioridad. Desde la Terminal
también puedes comprobarla: `php ~/sensum-cms/bin/console translate:test`.

**Aviso antes de que se acabe:** cuando la clave haya usado el **90 %** de sus caracteres
(900,000 de 1,000,000) llega un correo al correo de alertas (`it@gruposensum.com`), y
otro si se agotan. Así puedes crear una clave nueva y pegarla en **Traducción** a
tiempo. Se activa o desactiva en **Monitoreo → Alertas automáticas → Cuota de
traducción automática**; el porcentaje se puede cambiar con `TRANSLATE_ALERT_PERCENT`
en `.env` (50 a 99).

---

## 21. Verificación final

- [ ] `https://sensumconstrucciones.com` muestra el sitio nuevo, en celular y computadora; el botón EN funciona.
- [ ] `https://sensumconstrucciones.com/api/health` y `https://app.sensumconstrucciones.com/api/health` → `"status":"ok"`.
- [ ] **Cada dirección en su lugar:** `https://app.sensumconstrucciones.com` abre el panel; `https://sensumconstrucciones.com/admin` te lleva a `app.`; `http://sensumconstrucciones.com` y `https://www.sensumconstrucciones.com` terminan en `https://sensumconstrucciones.com`; `https://app.sensumconstrucciones.com/privacy-notice.html` te devuelve al sitio.
- [ ] `https://sensumconstrucciones.com/api/auth/session` → **404** (en el dominio público no se puede iniciar sesión).
- [ ] Los dos dominios tienen candado (paso 8.3).
- [ ] **Formulario de contacto:** envía un mensaje real desde el sitio (en celular y computadora). Bajo el botón aparece «Verificación anti-spam completa.» y el mensaje llega a `contacto@sensumconstrucciones.com` con remitente `formulario@`; al responderlo, la respuesta va al visitante.
- [ ] (Si activaste Turnstile) el formulario sigue enviando y no muestra errores; en Cloudflare → Turnstile aparecen las verificaciones.
- [ ] **Soporte:** con otra cuenta pulsa **Nueva solicitud** y envía una de prueba (aparece en **Mis solicitudes**); como it@gruposensum.com ábrelo, usa **Pedir más información** y luego **Marcar como resuelto**; la persona recibe ambos correos.
- [ ] (Opcional) Panel → **Formulario de contacto**: ajusta las preguntas y las opciones de «Servicio de interés» a lo que necesitas hoy. La **vista previa** funciona como el sitio: cambia entre **Celular, Tableta y Computadora**, las preguntas sin guardar dicen «Nueva» o «Modificada» y «Enviar mensaje» muestra los errores (no se envía nada). Luego **Guardar y publicar**, compruébalo en el sitio (español e inglés) y envía un mensaje de prueba: las respuestas extra aparecen en el correo y en **Prospectos**.
- [ ] **Aviso de privacidad** (`/privacy-notice.html`): léelo completo; dice el plazo de conservación elegido en Prospectos y, si activaste Turnstile, menciona a Cloudflare. Si cambias de proveedor de hosting o correo, avísanos para actualizarlo.
- [ ] **Correo del panel:** panel → Correo → **Enviar correo de prueba** → llega a it@gruposensum.com.
- [ ] Inicias sesión en `https://app.sensumconstrucciones.com` como it@gruposensum.com; ves Usuarios, Monitoreo, Informe mensual y Correo. El botón **Ver sitio** abre `https://sensumconstrucciones.com`.
- [ ] Los enlaces de los correos (invitación, bienvenida, «Prospecto #…», solicitudes) abren `https://app.sensumconstrucciones.com/admin/…`.
- [ ] Monitoreo → **Alertas automáticas**: todas activadas. **Archivos del sitio → Revisar ahora**: «Todo en orden».
- [ ] Monitoreo → **Correo y dominio → Revisar ahora**: SPF, DKIM, DMARC y MX en verde, y la fecha de vencimiento del dominio.
- [ ] Verificación en dos pasos activa en la cuenta propietaria (y códigos de recuperación guardados).
- [ ] Seguridad → **Enviar respaldo ahora**: el ZIP llega al correo elegido y se abre con la contraseña de respaldos.
- [ ] **Solicitar soporte** (botón arriba en el panel) → la **Nueva solicitud de soporte** llega a it@gruposensum.com con el nuevo diseño.
- [ ] **Monitoreo → Enviar correo de prueba** → llega la alerta de prueba.
- [ ] **Informe mensual → Enviarme una prueba** → llega.
- [ ] Invitas a una persona como «Redactor» (usa un correo tuyo) → al crear su contraseña le llega el **correo de bienvenida** y, al entrar, la pantalla para elegir **idioma y apariencia**; después solo ve «Textos del sitio».
- [ ] Cambias un texto, lo ves en el sitio (recarga con Ctrl+F5) y lo restauras.
- [ ] Subes una foto de proyecto y aparece en la tarjeta.
- [ ] `php ~/sensum-cms/bin/console cron` muestra las dos tareas `[ OK ]` y una revisión reciente; Monitoreo → «Última revisión automática» muestra una hora reciente.
- [ ] Después de enviar el mensaje de prueba del formulario: aparece en **Prospectos** (con el enlace «Prospecto #…» en el correo). Cámbialo a «Contactado» y agrega una nota.
- [ ] Prospectos → **Conservación de datos** elegida; el aviso de privacidad (`/privacy-notice.html`) dice el mismo número de meses.
- [ ] Abre el sitio en tu celular (sin «No rastrear») y toca el botón de WhatsApp: al rato, **Estadísticas** muestra la visita y el clic.
- [ ] Soporte → **Gestión de solicitudes**: objetivo de respuesta elegido; resuelve la solicitud de prueba y califícala con la otra cuenta; el **Panorama de soporte** la cuenta como resuelta.
- [ ] **Informe mensual → Descargar PDF** se abre bien; la prueba por correo trae el PDF adjunto.
- [ ] Traducción → **Probar conexión** dice «La clave funciona». En Textos del sitio, escribe en español y mira cómo se llena el inglés (luego descarta el cambio).
- [ ] Monitoreo → **Tendencias** muestra las gráficas (pasa el cursor para ver cada día) después de la primera hora de revisiones automáticas.
- [ ] Una persona «Administrador» o «Consulta (solo lectura)» ve **Salud del sitio** en su menú (uptime de 24 h / 7 / 30 / 90 días, gráficas e incidentes), sin el registro de errores.
- [ ] Monitoreo (cuenta propietaria) → **Disponibilidad (uptime)** e **Incidentes (30 días)** muestran datos después de las primeras revisiones automáticas.
- [ ] Una persona «Consulta (solo lectura)» ve **Estadísticas** sin mensajes del formulario ni el menú Prospectos, y **Más secciones** con lo que puede pedir.
- [ ] Si alguien da soporte técnico: un rol (por ejemplo «Consulta») + la sección adicional «Gestión de solicitudes de soporte» → ve todas las solicitudes y el **Panorama de soporte**; no ve Usuarios ni Monitoreo.
- [ ] **Informe mensual → Vista previa**: la pestaña **Para clientes** no menciona respaldos ni temas técnicos; en **Detalle técnico**, «Seguridad» dice «Protegido» (con HTTPS y respaldo reciente) o explica el motivo de «Requiere atención».
- [ ] Una persona «Administrador» ve **Estado del sitio → Informe mensual** (las dos pestañas) sin botones de envío.
- [ ] Usuarios → el **buscador** encuentra a una persona por nombre o correo.
- [ ] En **celular y tableta**: al desplazarte, la barra de arriba (menú, logo) queda fija; al abrir el menú lateral y desplazarlo, el logo y «Administrador de contenido» se quedan arriba. En **Soporte** se ven todos los filtros sin cortarse.
- [ ] Usuarios → **Ver como…**: revisa cada persona del equipo; su menú solo muestra lo que su rol permite. Termina con **Volver a mi cuenta**.
- [ ] Better Stack muestra ambos monitores en verde.

---

## 22. Publicar actualizaciones más adelante

1. Respalda (paso 2) y ejecuta `php ~/sensum-cms/bin/console backup`.
2. Genera el nuevo paquete (paso 3) y súbelo/extráelo en `/home/USUARIO`.
3. Reemplaza los archivos **sin borrar**: `sensum-cms/.env`, `sensum-cms/storage/` y
   `public_html/assets/uploads/` (ahí están tu configuración, la base de datos y las fotos).
4. Panel → **Volver a publicar el sitio** (o `bin/console publish`). Las
   actualizaciones de la base de datos se aplican solas.

**Lo mismo con la Terminal (recomendado).** Sube el zip a `/home/USUARIO` (nunca a
`public_html`) y escribe, uno por uno (cambia `release-…` por el nombre del zip, sin
`.zip`):

```bash
cd ~ && php ~/sensum-cms/bin/console backup
unzip -q release-….zip && ls release-…
rsync -a --exclude=".env" --exclude="storage/" ~/release-…/sensum-cms/ ~/sensum-cms/
rsync -a --exclude="assets/uploads/" --exclude="/index.html" --exclude="/404.html" --exclude="/privacy-notice.html" ~/release-…/public_html/ ~/public_html/
php ~/sensum-cms/bin/console publish
php ~/sensum-cms/bin/console cron:install
php ~/sensum-cms/bin/console cron
rm -rf ~/release-… ~/release-….zip
```

- El primer `rsync` actualiza el programa sin tocar tu configuración (`.env`) ni la base de
  datos (`storage/`). El segundo actualiza el sitio sin tocar las fotos
  (`assets/uploads/`) ni las tres páginas que genera el panel.
- `publish` vuelve a crear esas páginas con tu contenido (textos, fotos, captcha) y las
  plantillas nuevas; debe responder `Published. Changed: …`.
- Comprueba el resultado con `cat ~/sensum-cms/BUILD` (el código de la versión nueva).
- `cron:install` deja instaladas (o corrige) las tareas programadas del paso 16; si ya
  estaban bien responde `nothing changed`. `cron` debe mostrar las dos `[ OK ]`.
5. La revisión de archivos usa automáticamente la lista del nuevo paquete. Si alguna
   vez cambias un archivo del sitio a mano (a propósito), confirma el cambio en panel →
   **Monitoreo → Archivos del sitio → Revisar ahora → Marcar como esperados** (pide tu
   contraseña) o con `php ~/sensum-cms/bin/console integrity:accept`.

**Al actualizar a la versión de gestión de usuarios (octubre de 2026):** las cuentas con
el tipo de acceso **Administrador del sitio** reciben **Gestión de usuarios** (pueden
editar nombre y correo, contraseñas y verificación en dos pasos de quienes tienen menos
acceso); con la versión de roles simplificados ese tipo se llama **Administrador**. Si
alguna cuenta no debe tenerlo, cámbiala en Usuarios → «⋮» → **Cambiar rol** (por
ejemplo a «Editor del sitio web» con secciones adicionales). Las actualizaciones de la
base de datos se aplican solas.

**Al actualizar a la versión de roles simplificados (octubre de 2026):** antes de los
`rsync`, guarda una copia del programa actual por si hay que volver atrás:

```bash
cp -a ~/sensum-cms ~/sensum-cms-antes-roles
```

La base de datos se actualiza sola (migraciones `017_roles` y `018_device_reset`):
* **Roles:** quedan cuatro: **Administrador**, **Editor del sitio web**, **Ventas y
  prospectos** y **Consulta (solo lectura)**, más «Secciones adicionales» para
  excepciones. Cada cuenta que no tenía un rol completo pasa al rol más cercano **sin
  perder nada de lo que veía** (nunca a Administrador): por ejemplo, Redactor, Fotos y
  portafolio y Datos de contacto pasan a Editor del sitio web; Gerencia pasa a Consulta
  (ahora también ve el Informe mensual); Soporte técnico pasa a Consulta + sus secciones.
  La cuenta propietaria no cambia.
* Para ver qué cuentas cambió y cómo: `php ~/sensum-cms/bin/console roles`. Revisa la
  lista y corrige en **Usuarios → «⋮» → Cambiar rol** lo que haga falta (y con **Ver
  como…** que cada persona vea lo que corresponde).
* **Verificación en dos pasos:** «Restablecer» ahora es **Quitar dispositivos
  registrados**: al entrar, la persona confirma un código que le llega por correo y
  registra su dispositivo nuevo. Depende del correo del panel: comprueba antes que
  `php ~/sensum-cms/bin/console mail:test tu@correo` funcione.
* **Estadísticas:** filtros por período, **Exportar** y **Enviar por correo** (no hace
  falta configurar nada).
* **Wiki** (migración `019_wiki`): queda en **app.sensumconstrucciones.com/wiki** (el
  `.htaccess` nuevo la envía al panel) y en el menú **Ayuda y soporte → Wiki**, en lugar
  de «Guía de uso». Sus artículos y capturas viajan dentro de `sensum-cms/wiki/` (fuera
  de `public_html`): solo los ve quien inició sesión. Al entrar después de actualizar,
  cada persona ve una vez las **Novedades** que le corresponden según su rol. No hay
  nada que configurar. Para comprobarla: abre `https://app.sensumconstrucciones.com/wiki`
  (te pide iniciar sesión y luego la muestra).
* **Mejoras de uso** (migración `020_intro`, se aplica sola): Inicio habla según el rol
  y «Primeros pasos» se recuerda en la cuenta; en el celular, filtros en un botón,
  proyectos plegados y botones de 44 px; Usuarios en tarjetas por debajo de 1100 px; la
  pantalla «Centro de Ayuda» se llama ahora **Soporte**, como el menú. **Textos más
  largos:** cada texto conserva su largo recomendado y ahora admite más (párrafos el
  doble, títulos la mitad más, etiquetas un 30 %); el editor avisa al pasar lo
  recomendado. Los textos publicados no cambian. No hay nada que configurar.
* **Revisión automática** (sin migración): si te llegó el correo «La revisión
  automática dejó de ejecutarse», el cron del paso 16 no estaba instalado o fallaba.
  `cron:install` (ya está en los comandos de arriba) lo instala; para verla correr al
  momento: `php ~/sensum-cms/bin/console monitor`. Desde esta versión, un paso que
  falla queda en Monitoreo → Errores («Falló un paso de la revisión automática») y los
  demás siguen; el correo de la alerta indica el comando que la arregla. En la primera
  revisión después de tantos días pueden llegar avisos acumulados, una sola vez cada
  uno; por ejemplo, el **recordatorio de cada prospecto «Nuevo»** de los últimos 30
  días a quien atiende Prospectos.
* **Avisos al equipo** (migración `021_announcements`, se aplica sola): en
  **Administración → Avisos al equipo** la cuenta propietaria envía por correo las
  Novedades de cada actualización; cada persona recibe solo lo que puede usar. Solo
  necesita el correo del panel funcionando (`mail:test`). Después de actualizar,
  Inicio te recordará las novedades que el equipo todavía no recibió por correo.

**Volver atrás de esta versión**, de menos a más:
1. Solo los roles: `php ~/sensum-cms/bin/console roles:rollback` devuelve a cada cuenta
   el acceso que tenía (respeta las que ya corregiste a mano). Hazlo **antes** del punto 2:
   ese comando solo existe en la versión nueva.
2. El programa y el panel: sube el zip de la versión anterior (el que publicaste la vez
   pasada, por ejemplo `release-20261019-seo.zip`) y repite los mismos comandos de
   arriba con ese nombre (`unzip`, los dos `rsync` y `publish`). Así vuelven juntos el
   programa (`sensum-cms`) y el panel (`public_html/admin`). La versión anterior funciona
   con la base de datos nueva: las columnas y tablas nuevas no le estorban. Comprobado
   en un ensayo con la versión que está en producción (`ffbb133`): el panel abre con
   las mismas cuentas, textos y prospectos, y las páginas del sitio quedan idénticas.
   (Solo el programa, sin el panel: `rsync -a --delete --exclude=".env" --exclude="storage/" ~/sensum-cms-antes-roles/ ~/sensum-cms/`
   y `publish`; el panel nuevo pediría funciones que ese programa no tiene.)
3. Todo, incluida la base de datos: el paso 23 con la copia que hizo `backup` antes de
   actualizar.

Cuando todo esté bien unos días, borra la copia: `rm -rf ~/sensum-cms-antes-roles`.

**Al actualizar a la versión de cuentas y automatizaciones (octubre de 2026):** la base
de datos se actualiza sola. Lo nuevo no cambia el sitio público ni hace falta configurar
nada en el servidor:
* **Prospectos → Automatización:** el **recordatorio si sigue «Nuevo»** (48 horas) y el
  **resumen semanal de los lunes** quedan activados para quienes ven Prospectos; la
  asignación por servicio queda vacía hasta que la configuren. La **confirmación a quien
  escribe** queda **apagada** hasta que Sensum apruebe su texto.
* **Seguridad → Cuentas** (cuenta propietaria): «Rechazar contraseñas filtradas» queda
  activado (el servidor consulta `api.pwnedpasswords.com` por HTTPS; si no responde, no
  bloquea a nadie); «Desactivar cuentas sin uso» y «Recordar este dispositivo» quedan
  apagados.
* Las contraseñas temporales que dé un administrador vencen a las 72 horas si no se
  cambian.

**Al actualizar a la versión de octubre de 2026 (SEO):** después de **Volver a publicar
el sitio**, la pestaña del navegador en la portada dice «Constructora en Guatemala:
Construcción y Remodelaciones | Sensum» y aparece la sección **Textos del sitio →
Google (resultados de búsqueda)**. Los textos visibles no cambian. Haz luego los pasos
del 17b si aún no los hiciste.

**Al actualizar desde una versión anterior (perfiles de acceso nuevos):** las cuentas
que ya tenían **Prospectos** reciben también **Estadísticas de visitas** (antes iban
juntas), así nadie pierde lo que veía. **Gestión de solicitudes de soporte** no se le
da a nadie automáticamente: agrégala tú en Usuarios → «⋮» → **Cambiar rol** →
**Secciones adicionales** si alguien más atiende el soporte. Las cuentas que tenían
**Publicación y actividad** y **Salud del sitio** (Administrador del sitio y Soporte
técnico) reciben **Informe mensual (consulta)**. Revisa después con **Ver como…** que
cada persona vea lo que corresponde.
Las personas que ya habían entrado al panel no verán la pantalla de bienvenida (idioma
y apariencia); solo la ven las cuentas que entran por primera vez.

**Alternativa con Git (cPanel → Git Version Control):** cPanel puede clonar el
repositorio de GitHub y desplegarlo con un archivo `.cpanel.yml`, pero entonces
necesitas Composer en el servidor para instalar PHPMailer (en Namecheap compruébalo
con `composer -V` en la Terminal) y un `.cpanel.yml` que copie solo las carpetas
correctas. El paquete zip de esta guía es más simple y no depende de eso.

---

## 23. Volver atrás (si algo sale mal)

- **Solo el sitio público:** mueve a otra carpeta lo que subiste a `public_html` (deja
  `.well-known` y `cgi-bin`) y regresa ahí el contenido de `/home/USUARIO/sitio-anterior`
  (o extrae el zip del paso 2).
- **La base de datos:** reemplaza `sensum-cms/storage/database.sqlite` por una copia
  de `sensum-cms/storage/backups/db/`.
- **Solo los roles de octubre de 2026:** `php ~/sensum-cms/bin/console roles:rollback`
  (ver paso 22).
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
| No puedes iniciar sesión (te regresa al inicio) | Falta HTTPS en `app.` (paso 8.3) o `APP_URL` / `ADMIN_URL` del `.env` no son exactamente los del paso 9. |
| «No pudimos verificar la solicitud por seguridad» | Entraste por otra dirección: usa `https://app.sensumconstrucciones.com`. Revisa que `ADMIN_URL` sea `https://app.sensumconstrucciones.com/admin`. |
| `app.sensumconstrucciones.com` no abre («no se puede acceder al sitio») | El DNS de `app` aún no existe o no se ha propagado (paso 8.2). |
| `app.sensumconstrucciones.com` muestra el sitio público o te manda a `sensumconstrucciones.com` | El subdominio no comparte `public_html` (paso 8.1) o falta el `.htaccess` nuevo en `public_html` (paso 5, punto 7). |
| `app.sensumconstrucciones.com` (o el sitio) dice que la conexión no es privada | El certificado instalado no cubre los tres nombres: repite el paso 8.3 (3 a 5) con Let's Encrypt. No uses AutoSSL ni un certificado de un solo nombre. |
| Los enlaces de los correos abren `sensumconstrucciones.com/admin` | Falta `ADMIN_URL` en el `.env` (paso 9). Igual funcionan: esa dirección redirige a `app.`. |
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
| No aparece la traducción automática al editar | Panel → **Traducción**: debe decir «activada». Pulsa **Probar conexión**; si dice que la clave no funciona, pégala de nuevo (completa, con `:fx`). Si se acabó el mes gratuito, espera al siguiente o escribe el inglés a mano. |
| Monitoreo → Correo y dominio muestra un problema | cPanel → **Email Deliverability** → *Repair* (SPF/DKIM). Para DMARC, paso 6.3. |
| Llegan correos de «Nuevo inicio de sesión» | Es normal la primera vez en cada navegador. Si no fuiste tú: cambia la contraseña y usa «Cerrar sesión en otros dispositivos». |
| «Demasiados píxeles» o falla al subir fotos | Sube `memory_limit` a 256M (paso 4). |
| «El archivo es demasiado grande» | `upload_max_filesize` 20M y `post_max_size` 24M (paso 4). Con 16M, un PDF de más de 16 MB no sube. |
| «Última revisión automática: Nunca», o llega el correo «La revisión automática dejó de ejecutarse» | El cron no corre. En la Terminal: `php ~/sensum-cms/bin/console cron` (dice qué falta y el último error) y `php ~/sensum-cms/bin/console cron:install` (crea o corrige las tareas; paso 16). Luego `php ~/sensum-cms/bin/console monitor` una vez: la alerta deja de llegar. |
| Nadie ve «Usuarios» | Falta la cuenta propietaria o `OWNER_EMAIL` no coincide con su correo (paso 11). |

Registro técnico: `sensum-cms/storage/logs/app-AAAA-MM.log` y, en el panel,
**Monitoreo → Registro de errores**.
