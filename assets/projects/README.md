# Project photos — how to add them

Each card in the "Tipos de proyectos" section opens a modal with a small
3-slide carousel (Planificación / Ejecución / Entrega). Right now every
project uses **placeholder icons** there — generated artwork, not real
project photos — because no real, approved project photos exist yet
(see CONTENT-APPROVAL.md). The modal also shows an italic note saying
so, right under the project description.

You can switch any project over to real photos whenever you have them,
one project at a time, without touching any code.

## To add real photos to a project

1. **Get the client's confirmation** that the photos are OK to publish
   on the website, same as for any other project content.

2. **Add the image files to this folder.** A subfolder per project
   keeps things tidy — for example:

   ```
   assets/projects/remodelacion-residencial/1.jpg
   assets/projects/remodelacion-residencial/2.jpg
   assets/projects/remodelacion-residencial/3.jpg
   ```

   Any common image format works (`.jpg`, `.png`, `.webp`). There's no
   fixed number required — use however many photos make sense for that
   project (1, 2, 5, whatever you have).

3. **Open `index.html` and find that project's card.** Each of the six
   project cards in the "Tipos de proyectos" section is an
   `<article class="project-card ...">` tag, and each one already has
   an empty `data-images=""` attribute on it, ready to fill in. The
   first card also has a longer comment above it with these same
   instructions, in case you need a reminder later.

4. **Fill in that attribute** with the paths to your image files,
   separated by commas:

   ```html
   <article class="project-card ..." data-project="proj1"
            data-images="assets/projects/remodelacion-residencial/1.jpg, assets/projects/remodelacion-residencial/2.jpg, assets/projects/remodelacion-residencial/3.jpg">
   ```

5. **That's it — save and refresh.** As soon as `data-images` has one
   or more paths in it, that project's modal automatically:
   - shows your real photos instead of the placeholder icons,
   - hides the "reference images, real photos coming soon" note,
   - works with the existing arrows, dots, swipe, and keyboard
     navigation exactly like it already does today.

   Leave `data-images=""` empty on any project that doesn't have real
   photos yet — it'll keep showing the icon placeholders and the note,
   with no other changes needed.

## Notes

- This is separate from each card's own small thumbnail illustration
  (the icon shown on the card itself, before it's clicked). Turning
  that into a real photo too is a different, slightly bigger change —
  see the longer comment above the first project card in `index.html`
  for how (it also covers adding a location/scope line and optional
  before/after photos).
- Photos are shown with `object-fit: cover`, so mixed photo shapes and
  sizes all get cropped to fill the same frame consistently — you
  don't need to pre-crop or resize them to match each other.
- Each `<img>` is loaded with `loading="lazy"` and gets an automatic,
  readable `alt` text ("Foto 2 de Remodelación residencial" / "Photo 2
  of Remodelación residencial") generated from the project's own
  title — you don't need to write per-photo captions.
- Once a project has real photos, you may also want to update
  `CONTENT-APPROVAL.md`, which currently tracks every project as still
  using placeholder imagery.
