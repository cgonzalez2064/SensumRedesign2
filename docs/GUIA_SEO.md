# Guía de posicionamiento en buscadores (SEO) — Sensum Construcciones

**Objetivo:** que el sitio aparezca entre los primeros resultados de Google cuando se busca:

- Constructora
- Constructora Guatemala
- Servicios de construcción
- Remodelaciones
- Remodelaciones Guatemala

Esta guía explica qué se hizo en el sitio y qué pasos quedan fuera de él. Esos pasos
pesan tanto o más que el propio sitio. Las secciones 4 y 5 están pensadas para
reenviarse a la persona que administra el perfil de la empresa en Google.

---

## 1. Lo que ya se hizo en el sitio (octubre de 2026)

Por decisión de Sensum, **los textos visibles del sitio no cambiaron**. Se trabajó en lo
que leen los buscadores:

| Mejora | Detalle |
|---|---|
| Título y descripción para Google | **Título:** «Constructora en Guatemala: Construcción y Remodelaciones \| Sensum». **Descripción:** «Constructora en Guatemala con servicios de construcción y remodelaciones: diseño arquitectónico, obra civil, impermeabilización, instalaciones y mantenimiento.» Las vistas previas de WhatsApp y Facebook muestran lo mismo. |
| Editables desde el panel | **Textos del sitio → Google (resultados de búsqueda)**. Se recomienda que el título tenga hasta 60 caracteres, con las palabras que la gente busca al inicio, y que la descripción tenga entre 120 y 160. Existe una versión en inglés para el botón ES/EN. |
| Datos estructurados | Google recibe la ficha de la empresa como constructora (*GeneralContractor*): dirección, teléfonos, horario, Instagram, los seis servicios y los temas que domina («Construcción», «Servicios de construcción», «Remodelaciones»…). También recibe el nombre del sitio («Sensum Construcciones», que aparece sobre cada resultado) y las preguntas frecuentes. Todo se actualiza solo al publicar cambios en el panel. |
| Direcciones del sitio anterior | Las direcciones que Google conocía del sitio anterior ya no muestran «Página no encontrada». `/about`, `/services`, `/proyects`, `/contact`, `/index.php` y similares llevan a la sección equivalente con una redirección permanente (301). Así se conserva lo que el dominio había ganado desde 2019. |
| Una sola dirección por página | `/index.html` redirige a `/`, para que Google no cuente la portada dos veces. |
| Página de error | Se muestra con su diseño en cualquier dirección, incluso en las que tienen varias carpetas. |

**Limitación:** Google da más peso al texto que se ve en la página. Hoy el texto visible
dice «construcción» y «remodelación», pero no dice literalmente «constructora» ni
«servicios de construcción». Si más adelante Sensum aprueba ajustes de texto o páginas
propias para «Remodelaciones» y «Servicios de construcción», TeraDevs tiene una
propuesta lista para revisar.

---

## 2. Google Search Console (una sola vez, unos 15 minutos)

Search Console permite que Google conozca el sitio, muestra con qué búsquedas aparece
y avisa de errores. Lo realiza quien administra el dominio en Namecheap.

1. Ingrese a <https://search.google.com/search-console> con la cuenta de Google de la empresa.
2. **Agregar propiedad** → tipo **Dominio** → escriba `sensumconstrucciones.com` → **Continuar**.
3. Google mostrará un registro **TXT** que empieza con `google-site-verification=`. Cópielo.
4. En cPanel → **Zone Editor** → `sensumconstrucciones.com` → **Manage** → **Add Record**:
   - Tipo: **TXT**
   - Nombre: `sensumconstrucciones.com.`
   - Valor: el texto copiado
   - Guarde. Si el dominio usa otros DNS (Namecheap BasicDNS, Cloudflare), agréguelo allí.
5. Regrese a Search Console y pulse **Verificar**. Si aún no funciona, espere unos minutos
   u horas y vuelva a intentarlo.
6. **Sitemaps** → escriba `sitemap.xml` → **Enviar**.
7. **Inspección de URLs** → pegue `https://sensumconstrucciones.com/` → **Solicitar indexación**.
8. Si otra persona revisará los resultados: **Configuración → Usuarios y permisos → Agregar usuario**.

**Revisión mensual (5 minutos):**
- **Rendimiento:** las búsquedas con las que aparece el sitio, los clics y la posición
  media. Para seguir un término, use **Nueva → Consulta que contiene** (por ejemplo,
  «remodelaciones»).
- **Páginas:** que no aparezcan errores nuevos.

## 3. Bing (5 minutos)

Bing también abastece a otros buscadores y asistentes.

1. Ingrese a <https://www.bing.com/webmasters>.
2. Elija **Importar desde Google Search Console** y autorice. El sitio y el sitemap se
   copian solos.

---

## 4. Perfil de la empresa en Google (Google Business Profile)

> **Para la persona que administra el perfil.** Es lo que más influye en búsquedas como
> «constructora Guatemala» o «remodelaciones Guatemala»: Google suele mostrar primero un
> mapa con tres empresas, y ese lugar depende del perfil, no del sitio web.

**Datos (deben coincidir exactamente con el sitio web):**
- [ ] **Nombre:** «Sensum Construcciones», sin agregar palabras como «constructora» o
      «remodelaciones». Google lo prohíbe y puede suspender el perfil.
- [ ] **Categoría principal:** en el buscador de categorías, escriba «constructora» y
      elija la más cercana a *Empresa constructora* o *Contratista general*.
- [ ] **Categorías adicionales:** las relacionadas con remodelación, diseño
      arquitectónico e impermeabilización que ofrezca la lista.
- [ ] **Sitio web:** `https://sensumconstrucciones.com`
- [ ] **Dirección, teléfonos y horario:** idénticos a los del sitio (Edificio Ascend,
      13 Calle 5-31 Zona 9, Oficina 641, Ciudad de Guatemala; lunes a viernes de 8:00 a
      17:00 y sábados de 8:00 a 12:00).
- [ ] **Zona de servicio:** los municipios o departamentos donde realmente trabajan.

**Descripción sugerida** (máximo 750 caracteres; ajústela si algo no corresponde):

> Sensum Construcciones es una constructora en Guatemala que ofrece servicios de
> construcción y remodelaciones para proyectos residenciales, comerciales e
> institucionales. Realizamos diseño arquitectónico, obra civil, impermeabilización y
> tratamientos técnicos, instalaciones generales y mantenimiento preventivo, con
> planificación, supervisión técnica y presupuestos detallados en cada etapa. Nuestra
> oficina se encuentra en el Edificio Ascend, zona 9 de la Ciudad de Guatemala.

**Servicios:** agregue cada uno con una descripción breve (puede tomarla del sitio):
Remodelaciones · Diseño arquitectónico · Impermeabilización y tratamientos técnicos ·
Obra civil · Instalaciones generales · Mantenimiento preventivo.

**Actividad que mejora la posición:**
- [ ] **Fotografías:** logotipo, portada y fotos de proyectos y del equipo en obra.
      Agregue fotos nuevas con regularidad.
- [ ] **Reseñas:** pida una reseña a cada cliente satisfecho con el enlace de
      **Pedir reseñas** del perfil. Responda todas, positivas y negativas, con cortesía.
- [ ] **Publicaciones:** una o dos al mes (proyectos terminados, avances, temporada de
      impermeabilización…).
- [ ] **Preguntas y respuestas:** responda las preguntas que hagan los usuarios.

**Qué evitar:** perfiles duplicados, reseñas compradas o escritas por el propio
personal, y datos distintos a los del sitio.

---

## 5. Presencia en otros sitios

Google confía más en una empresa cuando otros sitios la mencionan con los mismos datos.

- [ ] **Instagram:** el enlace `https://sensumconstrucciones.com` en la biografía.
- [ ] **Facebook y LinkedIn de la empresa**, si existen: enlace al sitio y los mismos
      nombre, dirección y teléfono. Si se crean perfiles nuevos, avise a TeraDevs para
      agregarlos a los datos estructurados del sitio.
- [ ] **Sitio de Grupo Sensum**, si existe: un enlace a `sensumconstrucciones.com`.
- [ ] **Gremios y directorios:** el directorio de la Cámara Guatemalteca de la
      Construcción (si son miembros), directorios de empresas de Guatemala y portales de
      proveedores. Use siempre los mismos datos.

**Qué evitar:** comprar enlaces o aparecer en directorios de baja calidad. Eso perjudica
más de lo que ayuda.

---

## 6. Qué esperar

- **Indexación:** Google suele registrar los cambios en días, después de enviar el
  sitemap y solicitar la indexación.
- **Posiciones:** mejoran en semanas o pocos meses, a medida que crecen el perfil, las
  reseñas y los enlaces.
- **Términos generales:** «constructora», sin ciudad, es muy competido. Google lo trata
  como búsqueda local y le da gran peso al perfil de empresa y a la cercanía de quien
  busca.
- **Medición:** Search Console → **Rendimiento** (búsquedas, clics y posición) y panel →
  **Estadísticas** (visitas que llegan desde Google).

**Nunca** agregue al sitio texto oculto ni listas de palabras clave: Google lo considera
engaño y puede retirar el sitio de sus resultados.
