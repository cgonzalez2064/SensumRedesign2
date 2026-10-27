# Wiki del panel

La wiki (`app.sensumconstrucciones.com/wiki`, dentro del panel en `#/wiki`) explica
cada proceso con capturas reales. Solo la leen las cuentas que iniciaron sesión: estos
archivos están fuera de `public_html` y se sirven por la API (`WikiController`).

| Archivo | Qué es |
|---|---|
| `wiki.json` | Categorías y **Novedades** (las funciones nuevas que se anuncian una vez). |
| `articles/<slug>.es.md` y `.en.md` | Un artículo por idioma: encabezado (`title`, `summary`, `category`, `order`, `icon`, `perms`, `owner`, `updated`) y Markdown. |
| `img/<nombre>.<es\|en>.<light\|dark>.<desktop\|mobile>.webp` | Capturas, generadas con `tests/wiki/shots.mjs`. |

## Con cada cambio del panel

1. **Actualiza el artículo** en español e inglés (o crea uno nuevo). Escribe los botones
   tal como los muestra el panel, entre acentos graves: `` `Guardar cambios` ``.
2. **Función nueva:** agrega una entrada en `news` de `wiki.json` con `perms` (quién
   puede usarla; vacío = todos), `article`, `shot` y los textos en los dos idiomas.
   `"canAsk": true` la limita a quienes todavía pueden pedir alguna sección (como
   «Más secciones» en el menú: ni el propietario ni un Administrador).
   La verán una vez las cuentas que la pueden usar y ya existían ese día.
3. **Capturas:** `npm --prefix tests run wiki:shots` (todas) o
   `npm --prefix tests run wiki:shots -- '^estadisticas'` (algunas). Después,
   `-- '^wiki$'` para que la portada de la wiki muestre las capturas nuevas.
4. **Pruebas:** `npm --prefix tests test` revisa que cada artículo exista en los dos
   idiomas, que los botones citados existan en el panel, que los enlaces y las capturas
   (las 8 variantes) existan y que las novedades apunten a artículos reales.

## Markdown que entiende

`## Título` y `### Subtítulo` (los `##` forman «En esta página») · párrafos ·
listas con `-` · pasos con `1.` · `**negrita**`, `*cursiva*` · `` `Botón` `` ·
`[texto](wiki:slug)`, `[texto](#/ruta)` o `https://…` · tablas con `|` ·
`> [!tip]`, `> [!note]`, `> [!warn]`, `> [!important]` · `![pie de foto](shot:nombre)`.
Nunca HTML: el panel arma todo como texto.

## Quién ve qué

- Sin `perms` ni `owner`: todo el equipo.
- `perms: leads, stats`: se lee igual, pero quien no tiene ninguna de esas secciones lo
  ve marcado «No incluido en tu rol» (con «Pedir acceso»).
- `owner: true`: solo la cuenta propietaria.
