(function(){
  "use strict";
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ============================================================
     I18N — Spanish (default) / English dictionary + toggle.
     This is a single-URL, client-side language toggle (see the note
     in index.html's <head>) rather than separate /es/ and /en/
     documents. That keeps a non-technical owner able to edit every
     string for both languages in exactly one place (this object),
     with no build step and no risk of the two languages drifting
     apart across separate HTML files. The trade-off, documented in
     the completion report, is that only the server-rendered Spanish
     content is independently crawlable/indexable.
     ============================================================ */
  var I18N = {
    es: {
      "meta.title": "Sensum Construcciones | Construcción y Remodelación en Guatemala",
      "meta.description": "Empresa constructora en Ciudad de Guatemala: diseño arquitectónico, remodelación, ampliación y obra civil, con planificación, precisión y respaldo técnico.",
      "og.title": "Sensum Construcciones | Construcción y Remodelación en Guatemala",
      "og.description": "Construcción y remodelación con planificación, precisión y respaldo técnico en Ciudad de Guatemala. Conoce nuestros servicios y proyectos.",
      "og.locale": "es_GT",
      "twitter.title": "Sensum Construcciones Guatemala",
      "twitter.description": "Construcción y remodelación con planificación, precisión y respaldo técnico en Ciudad de Guatemala.",
      "brand.aria": "Sensum Construcciones - Inicio",
      "lang.toggle_aria": "Cambiar idioma",
      "menu.open_aria": "Abrir menú de navegación",
      "mobilenav.aria": "Menú móvil",
      "hero.panel_label": "Cómo trabajamos en Sensum Construcciones",
      "contact.map_aria": "Abrir la ubicación de Sensum Construcciones en Google Maps (se abre en una pestaña nueva)",
      "whatsapp.aria": "Chatea con nosotros por WhatsApp (se abre en una pestaña nueva)",
      "backtotop.aria": "Volver arriba",
      "a11y.new_tab": " (se abre en una pestaña nueva)",

      "nav.inicio": "Inicio", "nav.nosotros": "Nosotros", "nav.servicios": "Servicios",
      "nav.proyectos": "Tipos de proyectos", "nav.faq": "Preguntas frecuentes",
      "nav.contacto": "Contacto", "nav.cta": "Cotizar proyecto",

      "hero.eyebrow": "Construcción y remodelación en Ciudad de Guatemala",
      "hero.title": "Construcción y remodelación con planificación, <em>precisión</em> y respaldo técnico",
      "hero.desc": "Desarrollamos proyectos residenciales, comerciales e institucionales en Ciudad de Guatemala, desde el diseño y la cotización hasta la ejecución y entrega.",
      "hero.cta1": "Solicitar evaluación técnica",
      "hero.cta2": "Conocer nuestros proyectos",
      "hero.badge1": "Comunicación clara",
      "hero.badge2": "Supervisión técnica",
      "hero.badge3": "Presupuestos detallados",

      "pillar.plan_label": "Planificación",
      "pillar.precision_label": "Precisión",
      "pillar.comm_label": "Comunicación clara",
      "pillar.support_label": "Respaldo técnico",

      "about.art_caption": "Planificación y supervisión técnica en cada etapa del proyecto.",
      "about.eyebrow": "Quiénes somos",
      "about.title": "Nosotros",
      "about.desc": "En Sensum Construcciones planificamos y ejecutamos proyectos de diseño, remodelación, ampliación y obra civil. Nuestro equipo acompaña cada etapa con comunicación clara, supervisión técnica y presupuestos detallados, para que cada cliente conozca el alcance, el proceso y los avances de su proyecto.",
      "about.mission_title": "Misión",
      "about.mission_desc": "Diseñar y ejecutar soluciones de construcción funcionales, seguras y duraderas, mediante procesos transparentes, supervisión técnica y atención cercana en cada etapa.",
      "about.vision_title": "Visión",
      "about.vision_desc": "Consolidarnos como una empresa de construcción reconocida en Guatemala por la calidad de su ejecución, el cumplimiento de sus compromisos y la confianza de sus clientes.",

      "services.eyebrow": "Lo que hacemos",
      "services.title": "Servicios",
      "services.desc": "Soluciones de diseño, construcción y mantenimiento adaptadas a las condiciones, objetivos y presupuesto de cada proyecto.",
      "service1.title": "Remodelaciones",
      "service1.desc": "Ampliación y redistribución de ambientes, texturizado y pintura profesional, fachaletas o piedra decorativa, y restauración de pisos y cielo falso.",
      "service2.title": "Diseño arquitectónico",
      "service2.desc": "Conceptualización, desarrollo de anteproyecto, elaboración de planos a nivel de anteproyecto y constructivo, y acompañamiento técnico durante todo el diseño.",
      "service3.title": "Impermeabilización y tratamientos técnicos",
      "service3.desc": "Impermeabilización de losas y cubiertas, tratamiento de muros húmedos y curado de hongo, sellado de superficies naturales y reparación de fisuras y juntas frías.",
      "service4.title": "Obra civil",
      "service4.desc": "Trazado y movimiento de tierra, armado de estructura y cimentación, levantamiento de muros y fundición de losas y gradas, con procesos técnicos y seguros.",
      "service5.title": "Instalaciones generales",
      "service5.desc": "Instalaciones hidráulicas, eléctricas, de climatización y comunicaciones, además de instalaciones especiales como gas y equipos de bombeo o presión.",
      "service6.title": "Mantenimiento preventivo",
      "service6.desc": "Limpieza de losas, bajadas pluviales, filtros y calentadores, revisión de instalaciones eléctricas y cuidado de áreas verdes, con planes preventivos y correctivos.",
      "services.cta": "Solicitar cotización",

      "process.eyebrow": "Cómo trabajamos",
      "process.title": "Nuestro proceso",
      "process1.title": "Consulta inicial", "process1.desc": "Conocemos tus necesidades, el tipo de inmueble y el alcance preliminar.",
      "process2.title": "Visita y propuesta", "process2.desc": "Evaluamos el espacio y preparamos una propuesta con alcance, tiempos y presupuesto.",
      "process3.title": "Planificación y ejecución", "process3.desc": "Coordinamos recursos, supervisamos los trabajos y comunicamos el avance.",
      "process4.title": "Entrega y garantía", "process4.desc": "Revisamos contigo el resultado final y documentamos las condiciones de garantía aplicables.",

      "projects.eyebrow": "Nuestro trabajo",
      "projects.title": "Tipos de proyectos",
      "projects.desc": "Categorías de proyectos que desarrollamos, adaptadas a cada tipo de inmueble, alcance y presupuesto.",
      "proj1.tag": "Residencial", "proj1.title": "Remodelación residencial", "proj1.desc": "Renovación integral de espacios habitacionales.",
      "proj2.tag": "Comercial", "proj2.title": "Ampliación comercial", "proj2.desc": "Crecimiento de espacios para locales y oficinas.",
      "proj3.tag": "Obra civil", "proj3.title": "Obra gris y cimentación", "proj3.desc": "Estructuras seguras desde los cimientos.",
      "proj4.tag": "Diseño", "proj4.title": "Diseño arquitectónico", "proj4.desc": "Planos y anteproyectos a la medida del cliente.",
      "proj5.tag": "Nueva construcción", "proj5.title": "Construcción desde cero", "proj5.desc": "Proyectos completos, de la concepción a la entrega.",
      "proj6.tag": "Mantenimiento", "proj6.title": "Mantenimiento general", "proj6.desc": "Planes preventivos y correctivos a la medida.",
      "projects.cta": "Conversemos sobre tu proyecto",

      "ctabanner.title": "¡Comencemos tu proyecto!",
      "ctabanner.desc": "Escríbenos hoy y agenda una evaluación técnica con nuestro equipo.",
      "ctabanner.cta": "Contáctanos ahora",

      "contact.eyebrow": "Hablemos",
      "contact.title": "Contacto",
      "contact.desc": "Cuéntanos qué deseas construir, ampliar o renovar. Revisaremos la información y nos comunicaremos contigo para definir el siguiente paso.",
      "contact.label_address": "Dirección", "contact.label_phone": "Teléfono", "contact.label_email": "Correo",
      "contact.label_hours": "Horario", "contact.hours_value": "Lunes a viernes, 8:00 – 17:30",
      "contact.label_social": "Instagram",
      "contact.map_open": "Abrir en Google Maps",

      "form.title": "Envíanos un mensaje",
      "form.name_label": "Nombre completo", "form.name_err": "Ingresa tu nombre completo.",
      "form.phone_label": "Teléfono", "form.phone_err": "Ingresa un número de teléfono válido.",
      "form.email_label": "Correo electrónico", "form.email_err": "Ingresa un correo electrónico válido.",
      "form.service_label": "Servicio de interés",
      "form.opt_placeholder": "Selecciona un servicio",
      "form.opt_remodel": "Remodelaciones", "form.opt_design": "Diseño arquitectónico",
      "form.opt_waterproof": "Impermeabilización y tratamientos técnicos", "form.opt_civil": "Obra civil",
      "form.opt_installations": "Instalaciones generales", "form.opt_maintenance": "Mantenimiento preventivo",
      "form.opt_other": "Otro",
      "form.service_err": "Selecciona el servicio que te interesa.",
      "form.message_label": "Cuéntanos sobre tu proyecto",
      "form.message_err": "Cuéntanos un poco más sobre tu proyecto (mínimo 10 caracteres).",
      "form.hp_label": "No completar este campo",
      "form.submit": "Enviar mensaje",
      "form.note": "Usaremos tus datos únicamente para responder a tu solicitud y dar seguimiento a tu proyecto. Consulta nuestro <a href=\"privacy-notice.html\">Aviso de Privacidad</a>.",
      "form.fallback": "¿Prefieres no usar el formulario? Escríbenos por <a href=\"tel:+50222567954\">teléfono</a>, <a href=\"mailto:contacto@sensumconstrucciones.com\">correo</a> o <a href=\"https://wa.me/50234819804\" target=\"_blank\" rel=\"noopener noreferrer\">WhatsApp</a>.",
      "form.status_sending": "Enviando…",
      "form.status_ok": "¡Gracias! Tu mensaje ha sido enviado. Te contactaremos pronto.",
      "form.status_invalid": "Revisa los campos marcados antes de enviar.",
      "form.status_error": "Hubo un problema al enviar tu mensaje. Intenta de nuevo o escríbenos por WhatsApp.",
      "form.status_rate_limited": "Has enviado varias solicitudes en poco tiempo. Espera unos minutos e intenta de nuevo.",
      "form.status_offline": "Parece que no tienes conexión a internet. Revisa tu conexión e intenta de nuevo.",
      "form.status_timeout": "El envío tardó demasiado. Revisa tu conexión e intenta de nuevo.",

      "faq.eyebrow": "Dudas frecuentes",
      "faq.title": "Preguntas frecuentes",
      "faq.q1": "¿Qué tipos de proyectos realiza Sensum Construcciones?",
      "faq.a1": "Trabajamos en remodelaciones, diseño arquitectónico, impermeabilización y tratamientos técnicos, obra civil, instalaciones generales y mantenimiento preventivo, para proyectos residenciales, comerciales e institucionales.",
      "faq.q2": "¿Cómo es el proceso para iniciar un proyecto?",
      "faq.a2": "Iniciamos con una consulta inicial para conocer tus necesidades, seguida de una visita y una propuesta con alcance, tiempos y presupuesto. Luego coordinamos la planificación y ejecución, y finalizamos con la entrega y la documentación de garantía.",
      "faq.q3": "¿En qué zona de Guatemala trabajan?",
      "faq.a3": "Desarrollamos proyectos residenciales, comerciales e institucionales en Ciudad de Guatemala.",
      "faq.q4": "¿Cuál es su horario de atención?",
      "faq.a4": "Atendemos de lunes a viernes, de 8:00 a 17:30.",
      "faq.q5": "¿Cómo puedo contactarlos?",
      "faq.a5": "Puedes escribirnos por WhatsApp o teléfono, enviarnos un correo, o completar el formulario de contacto de este sitio; también puedes visitarnos en nuestra oficina en Ciudad de Guatemala.",
      "faq.q6": "¿El sitio está disponible en inglés?",
      "faq.a6": "Sí. Puedes cambiar el idioma del sitio con el botón ES/EN en la parte superior.",

      "footer.about_desc": "Diseño y construcción profesional en Ciudad de Guatemala.",
      "footer.links_heading": "Enlaces", "footer.services_heading": "Servicios", "footer.contact_heading": "Contacto",
      "footer.social_label": "Síguenos en Instagram",
      "footer.privacy_link": "Aviso de Privacidad",
      "footer.rights": "Todos los derechos reservados.",

      "whatsapp.message": "Hola, me interesa solicitar información sobre sus servicios."
    },
    en: {
      "meta.title": "Sensum Construcciones | Construction & Remodeling in Guatemala",
      "meta.description": "Construction company in Guatemala City: architectural design, remodeling, additions, and civil works, built on planning, precision, and technical support.",
      "og.title": "Sensum Construcciones | Construction & Remodeling in Guatemala",
      "og.description": "Construction and remodeling built on planning, precision, and technical support in Guatemala City. See our services and projects.",
      "og.locale": "en_US",
      "twitter.title": "Sensum Construcciones Guatemala",
      "twitter.description": "Construction and remodeling built on planning, precision, and technical support in Guatemala City.",
      "brand.aria": "Sensum Construcciones - Home",
      "lang.toggle_aria": "Switch language",
      "menu.open_aria": "Open navigation menu",
      "mobilenav.aria": "Mobile menu",
      "hero.panel_label": "How we work at Sensum Construcciones",
      "contact.map_aria": "Open Sensum Construcciones' location in Google Maps (opens in a new tab)",
      "whatsapp.aria": "Chat with us on WhatsApp (opens in a new tab)",
      "backtotop.aria": "Back to top",
      "a11y.new_tab": " (opens in a new tab)",

      "nav.inicio": "Home", "nav.nosotros": "About", "nav.servicios": "Services",
      "nav.proyectos": "Types of Projects", "nav.faq": "FAQ",
      "nav.contacto": "Contact", "nav.cta": "Get a Quote",

      "hero.eyebrow": "Construction and Remodeling in Guatemala City",
      "hero.title": "Construction and remodeling built on planning, <em>precision</em>, and technical support",
      "hero.desc": "We develop residential, commercial, and institutional projects in Guatemala City, from design and quoting through execution and delivery.",
      "hero.cta1": "Request a Technical Evaluation",
      "hero.cta2": "See Our Projects",
      "hero.badge1": "Clear communication",
      "hero.badge2": "Technical supervision",
      "hero.badge3": "Detailed budgets",

      "pillar.plan_label": "Planning",
      "pillar.precision_label": "Precision",
      "pillar.comm_label": "Clear communication",
      "pillar.support_label": "Technical support",

      "about.art_caption": "Planning and technical supervision at every stage of the project.",
      "about.eyebrow": "Who we are",
      "about.title": "About Us",
      "about.desc": "At Sensum Construcciones, we plan and execute design, remodeling, addition, and civil works projects. Our team supports every stage with clear communication, technical supervision, and detailed budgets, so each client understands the scope, process, and progress of their project.",
      "about.mission_title": "Mission",
      "about.mission_desc": "To design and execute functional, safe, and durable construction solutions through transparent processes, technical supervision, and close attention at every stage.",
      "about.vision_title": "Vision",
      "about.vision_desc": "To establish ourselves as a construction company recognized in Guatemala for the quality of our execution, our commitment to our promises, and the trust of our clients.",

      "services.eyebrow": "What we do",
      "services.title": "Services",
      "services.desc": "Design, construction, and maintenance solutions tailored to the conditions, goals, and budget of each project.",
      "service1.title": "Remodeling",
      "service1.desc": "Room additions and layout changes, wall texturing and professional painting, decorative stone or cladding, and floor and ceiling restoration.",
      "service2.title": "Architectural Design",
      "service2.desc": "Concept development, preliminary design, blueprints at both schematic and construction level, and technical follow-through on every design.",
      "service3.title": "Waterproofing & Technical Treatments",
      "service3.desc": "Waterproofing of slabs and roofs, treatment of damp walls and mold remediation, sealing of natural surfaces, and repair of cracks and cold joints.",
      "service4.title": "Civil Works",
      "service4.desc": "Site layout and earthmoving, structural framing and foundations, wall construction, and slab and stair casting, carried out with safe, technical processes.",
      "service5.title": "General Installations",
      "service5.desc": "Plumbing, electrical, HVAC, and communications installations, plus specialized systems such as gas lines and pumping or pressure equipment.",
      "service6.title": "Preventive Maintenance",
      "service6.desc": "Cleaning of slabs, rain drains, filters, and water heaters, review of electrical systems, and landscaping upkeep, through preventive and corrective plans.",
      "services.cta": "Request a Quote",

      "process.eyebrow": "How we work",
      "process.title": "Our Process",
      "process1.title": "Initial Consultation", "process1.desc": "We learn about your needs, the type of property, and the preliminary scope.",
      "process2.title": "Site Visit & Proposal", "process2.desc": "We assess the space and prepare a proposal with scope, timeline, and budget.",
      "process3.title": "Planning & Execution", "process3.desc": "We coordinate resources, supervise the work, and communicate progress.",
      "process4.title": "Delivery & Warranty", "process4.desc": "We review the final result together and document the applicable warranty terms.",

      "projects.eyebrow": "Our work",
      "projects.title": "Types of Projects",
      "projects.desc": "Categories of projects we take on, adapted to each property type, scope, and budget.",
      "proj1.tag": "Residential", "proj1.title": "Residential Remodel", "proj1.desc": "Full renovation of living spaces.",
      "proj2.tag": "Commercial", "proj2.title": "Commercial Addition", "proj2.desc": "Growing spaces for shops and offices.",
      "proj3.tag": "Civil Works", "proj3.title": "Gray Shell & Foundation", "proj3.desc": "Safe structures from the ground up.",
      "proj4.tag": "Design", "proj4.title": "Architectural Design", "proj4.desc": "Custom plans and preliminary designs for the client.",
      "proj5.tag": "New Construction", "proj5.title": "Ground-Up Construction", "proj5.desc": "Complete projects, from conception to delivery.",
      "proj6.tag": "Maintenance", "proj6.title": "General Maintenance", "proj6.desc": "Preventive and corrective plans tailored to your needs.",
      "projects.cta": "Let's Talk About Your Project",

      "ctabanner.title": "Let's start your project!",
      "ctabanner.desc": "Write to us today and schedule a technical evaluation with our team.",
      "ctabanner.cta": "Contact Us Now",

      "contact.eyebrow": "Let's talk",
      "contact.title": "Contact",
      "contact.desc": "Tell us what you'd like to build, expand, or renovate. We'll review the information and get in touch with you to define the next step.",
      "contact.label_address": "Address", "contact.label_phone": "Phone", "contact.label_email": "Email",
      "contact.label_hours": "Hours", "contact.hours_value": "Monday to Friday, 8:00 AM – 5:30 PM",
      "contact.label_social": "Instagram",
      "contact.map_open": "Open in Google Maps",

      "form.title": "Send Us a Message",
      "form.name_label": "Full name", "form.name_err": "Enter your full name.",
      "form.phone_label": "Phone", "form.phone_err": "Enter a valid phone number.",
      "form.email_label": "Email address", "form.email_err": "Enter a valid email address.",
      "form.service_label": "Service of interest",
      "form.opt_placeholder": "Select a service",
      "form.opt_remodel": "Remodeling", "form.opt_design": "Architectural design",
      "form.opt_waterproof": "Waterproofing & technical treatments", "form.opt_civil": "Civil works",
      "form.opt_installations": "General installations", "form.opt_maintenance": "Preventive maintenance",
      "form.opt_other": "Other",
      "form.service_err": "Select the service you're interested in.",
      "form.message_label": "Tell us about your project",
      "form.message_err": "Tell us a bit more about your project (minimum 10 characters).",
      "form.hp_label": "Leave this field blank",
      "form.submit": "Send Message",
      "form.note": "We will only use your information to respond to your request and follow up on your project. See our <a href=\"privacy-notice.html\">Privacy Notice</a>.",
      "form.fallback": "Prefer not to use the form? Write to us by <a href=\"tel:+50222567954\">phone</a>, <a href=\"mailto:contacto@sensumconstrucciones.com\">email</a>, or <a href=\"https://wa.me/50234819804\" target=\"_blank\" rel=\"noopener noreferrer\">WhatsApp</a>.",
      "form.status_sending": "Sending…",
      "form.status_ok": "Thank you! Your message has been sent. We'll get back to you soon.",
      "form.status_invalid": "Please check the highlighted fields before submitting.",
      "form.status_error": "There was a problem sending your message. Please try again or message us on WhatsApp.",
      "form.status_rate_limited": "You've sent several requests in a short time. Please wait a few minutes and try again.",
      "form.status_offline": "It looks like you're offline. Check your connection and try again.",
      "form.status_timeout": "The request took too long. Check your connection and try again.",

      "faq.eyebrow": "Common questions",
      "faq.title": "Frequently Asked Questions",
      "faq.q1": "What types of projects does Sensum Construcciones handle?",
      "faq.a1": "We work on remodeling, architectural design, waterproofing and technical treatments, civil works, general installations, and preventive maintenance, for residential, commercial, and institutional projects.",
      "faq.q2": "What's the process for starting a project?",
      "faq.a2": "We start with an initial consultation to understand your needs, followed by a site visit and a proposal covering scope, timeline, and budget. We then coordinate planning and execution, and finish with delivery and warranty documentation.",
      "faq.q3": "Where in Guatemala do you work?",
      "faq.a3": "We develop residential, commercial, and institutional projects in Guatemala City.",
      "faq.q4": "What are your business hours?",
      "faq.a4": "We're available Monday through Friday, 8:00 AM to 5:30 PM.",
      "faq.q5": "How can I contact you?",
      "faq.a5": "You can reach us on WhatsApp or by phone, send us an email, or fill out the contact form on this site; you're also welcome to visit our office in Guatemala City.",
      "faq.q6": "Is the site available in English?",
      "faq.a6": "Yes. You can switch the site's language using the ES/EN button at the top.",

      "footer.about_desc": "Professional design and construction in Guatemala City.",
      "footer.links_heading": "Links", "footer.services_heading": "Services", "footer.contact_heading": "Contact",
      "footer.social_label": "Follow us on Instagram",
      "footer.privacy_link": "Privacy Notice",
      "footer.rights": "All rights reserved.",

      "whatsapp.message": "Hi, I'm interested in requesting information about your services."
    }
  };

  var LANG_KEY = 'sensum_lang';
  var currentLang = (function(){
    try {
      var saved = localStorage.getItem(LANG_KEY);
      if (saved === 'es' || saved === 'en') return saved;
    } catch (e) { /* localStorage may be unavailable — fall back silently */ }
    return 'es';
  })();

  var WHATSAPP_NUMBER = '50234819804';
  var whatsappFab = document.getElementById('whatsappFab');
  var langToggle = document.getElementById('langToggle');
  var pageTitleEl = document.getElementById('pageTitle');
  var metaDescriptionEl = document.getElementById('metaDescription');
  var ogTitleEl = document.getElementById('ogTitle');
  var ogDescriptionEl = document.getElementById('ogDescription');
  var ogLocaleEl = document.getElementById('ogLocale');
  var twitterTitleEl = document.getElementById('twitterTitle');
  var twitterDescriptionEl = document.getElementById('twitterDescription');

  function applyLang(lang){
    var dict = I18N[lang] || I18N.es;
    currentLang = lang;

    document.documentElement.lang = (lang === 'es') ? 'es-GT' : 'en';

    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var key = el.getAttribute('data-i18n');
      var val = dict[key];
      if (val === undefined) return;
      if (val.indexOf('<') !== -1) { el.innerHTML = val; }
      else { el.textContent = val; }
    });

    /* data-i18n-html: dictionary value is trusted, hand-authored markup
       (never user input) — always applied as innerHTML so links inside
       (e.g. the privacy-notice / WhatsApp links in the form note) survive
       a language switch. */
    document.querySelectorAll('[data-i18n-html]').forEach(function(el){
      var key = el.getAttribute('data-i18n-html');
      var val = dict[key];
      if (val !== undefined) el.innerHTML = val;
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(function(el){
      var spec = el.getAttribute('data-i18n-attr');
      spec.split(';').forEach(function(pair){
        var parts = pair.split(':');
        if (parts.length !== 2) return;
        var attr = parts[0].trim(), key = parts[1].trim();
        var val = dict[key];
        if (val !== undefined) el.setAttribute(attr, val);
      });
    });

    if (pageTitleEl && dict['meta.title']){
      pageTitleEl.textContent = dict['meta.title'];
      document.title = dict['meta.title'];
    }
    /* Runtime metadata update for the client-side toggle. Real crawlers
       fetch the raw HTML and never run this, so the server-rendered
       Spanish tags in <head> remain what search engines and share-link
       unfurlers see — this only keeps the DOM honest for anything that
       reads it live (e.g. a browser extension, or the user's own view
       of "Page info"). See the <head> note for the full rationale. */
    if (metaDescriptionEl && dict['meta.description']) metaDescriptionEl.setAttribute('content', dict['meta.description']);
    if (ogTitleEl && dict['og.title']) ogTitleEl.setAttribute('content', dict['og.title']);
    if (ogDescriptionEl && dict['og.description']) ogDescriptionEl.setAttribute('content', dict['og.description']);
    if (ogLocaleEl && dict['og.locale']) ogLocaleEl.setAttribute('content', dict['og.locale']);
    if (twitterTitleEl && dict['twitter.title']) twitterTitleEl.setAttribute('content', dict['twitter.title']);
    if (twitterDescriptionEl && dict['twitter.description']) twitterDescriptionEl.setAttribute('content', dict['twitter.description']);

    if (langToggle){
      langToggle.textContent = (lang === 'es') ? 'EN' : 'ES';
    }

    if (whatsappFab && dict['whatsapp.message']){
      whatsappFab.setAttribute('href', 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(dict['whatsapp.message']));
    }

    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* ignore */ }
  }

  applyLang(currentLang);

  if (langToggle){
    langToggle.addEventListener('click', function(){
      applyLang(currentLang === 'es' ? 'en' : 'es');
    });
  }

  /* ---------- Footer year ---------- */
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  /* ---------- Header: translucent on scroll ---------- */
  var header = document.getElementById('siteHeader');
  var lastY = -1;
  function onScrollHeader(){
    if (!header) return;
    var sc = window.scrollY > 24;
    if (sc !== lastY){ header.classList.toggle('is-scrolled', sc); lastY = sc; }
  }
  if (header){
    document.addEventListener('scroll', onScrollHeader, { passive: true });
    onScrollHeader();
  }

  /* ---------- Mobile nav: open/close, focus trap, inert background,
     Escape + backdrop close, focus restore on close ---------- */
  var toggle = document.getElementById('menuToggle');
  var nav = document.getElementById('mobileNav');
  var scrim = document.getElementById('navScrim');
  var lastFocused = null;

  if (toggle && nav && scrim){
    var mainEl = document.getElementById('main');
    var footerEl = document.querySelector('.site-footer');
    var backToTopEl = document.getElementById('backToTop');
    var whatsappFabEl = document.getElementById('whatsappFab');
    var backgroundTargets = [mainEl, footerEl, backToTopEl, whatsappFabEl].filter(Boolean);
    var supportsInert = 'inert' in HTMLElement.prototype;
    var FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

    /* Generic inert toggler, used both for the background (page content
       behind the open drawer) and for the drawer itself (which starts
       `inert` in the HTML so its links are never in the tab order or
       exposed to assistive tech while closed — matching its
       aria-hidden="true" default, which by itself only hides content
       from assistive tech and does NOT remove it from the keyboard tab
       order). Falls back to manual tabindex bookkeeping on browsers
       without native `inert` support. */
    var setInert = function(elements, on, tabindexBackups){
      elements.forEach(function(el){
        if (supportsInert){
          if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
        } else if (on){
          el.setAttribute('aria-hidden', 'true');
        } else {
          el.removeAttribute('aria-hidden');
        }
      });
      if (!supportsInert){
        if (on){
          tabindexBackups.length = 0;
          elements.forEach(function(root){
            root.querySelectorAll(FOCUSABLE_SELECTOR).forEach(function(el){
              tabindexBackups.push([el, el.getAttribute('tabindex')]);
              el.setAttribute('tabindex', '-1');
            });
            if (root.matches && root.matches(FOCUSABLE_SELECTOR)){
              tabindexBackups.push([root, root.getAttribute('tabindex')]);
              root.setAttribute('tabindex', '-1');
            }
          });
        } else {
          tabindexBackups.forEach(function(pair){
            var el = pair[0], prev = pair[1];
            if (prev === null) el.removeAttribute('tabindex'); else el.setAttribute('tabindex', prev);
          });
          tabindexBackups.length = 0;
        }
      }
    }
    var backgroundTabindexBackup = [];
    var navTabindexBackup = [];

    var trapKeydown = function(e){
      if (e.key !== 'Tab') return;
      var focusables = Array.prototype.slice.call(nav.querySelectorAll(FOCUSABLE_SELECTOR));
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first){
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last){
        e.preventDefault(); first.focus();
      }
    }

    var openNav = function(){
      lastFocused = document.activeElement;
      nav.classList.add('is-open');
      scrim.classList.add('is-open');
      setInert([nav], false, navTabindexBackup);
      nav.setAttribute('aria-hidden', 'false');
      toggle.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      setInert(backgroundTargets, true, backgroundTabindexBackup);
      document.addEventListener('keydown', trapKeydown);
      var firstLink = nav.querySelector('a');
      if (firstLink) firstLink.focus();
    }
    var closeNav = function(){
      nav.classList.remove('is-open');
      scrim.classList.remove('is-open');
      nav.setAttribute('aria-hidden', 'true');
      setInert([nav], true, navTabindexBackup);
      toggle.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      setInert(backgroundTargets, false, backgroundTabindexBackup);
      document.removeEventListener('keydown', trapKeydown);
      if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }
    toggle.addEventListener('click', function(){
      (nav.classList.contains('is-open') ? closeNav : openNav)();
    });
    scrim.addEventListener('click', closeNav);
    nav.querySelectorAll('a').forEach(function(a){ a.addEventListener('click', closeNav); });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape' && nav.classList.contains('is-open')) closeNav();
    });
  }

  /* ---------- Active nav link on scroll ---------- */
  var sections = ['inicio','nosotros','servicios','proyectos','faq','contacto']
    .map(function(id){ return document.getElementById(id); }).filter(Boolean);
  var deskLinks = document.querySelectorAll('.nav-desktop a');
  if ('IntersectionObserver' in window && sections.length){
    var navObserver = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if (entry.isIntersecting){
          var id = entry.target.id;
          deskLinks.forEach(function(a){
            a.classList.toggle('active', a.getAttribute('href') === '#' + id);
          });
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function(s){ navObserver.observe(s); });
  }

  /* ---------- Reveal on scroll (no-JS / no-IntersectionObserver fallback
     is handled in index.html via <noscript> and the check below) ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length){
    var revealObserver = new IntersectionObserver(function(entries, obs){
      entries.forEach(function(entry){
        if (entry.isIntersecting){
          entry.target.classList.add('in-view');
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function(el){ revealObserver.observe(el); });
  } else {
    revealEls.forEach(function(el){ el.classList.add('in-view'); });
  }

  /* ---------- Back to top ---------- */
  var backToTop = document.getElementById('backToTop');
  if (backToTop){
    document.addEventListener('scroll', function(){
      backToTop.classList.toggle('show', window.scrollY > 600);
    }, { passive: true });
    backToTop.addEventListener('click', function(){
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  /* ============================================================
     Contact form — client-side validation (a UX convenience only;
     assets/contact-handler.php re-validates everything server-side),
     honeypot + minimum-completion-time anti-spam signals, and a
     defensive fetch() that handles non-JSON responses, HTTP status
     categories, timeouts, duplicate submits, offline errors, and
     field-specific errors returned by the server. Field values are
     preserved on any failure and cleared only after a confirmed
     success.
     ============================================================ */
  var form = document.getElementById('contactForm');
  var status = document.getElementById('formStatus');
  var summary = document.getElementById('formSummary');
  function t(key){ return (I18N[currentLang] && I18N[currentLang][key]) || I18N.es[key] || key; }

  /* Minimum-completion-time signal: stamped once, invisible, never an
     expectation placed on the visitor — purely a server-side anti-spam
     input alongside the honeypot. */
  var loadedAtField = document.getElementById('formLoadedAt');
  if (loadedAtField) loadedAtField.value = String(Date.now());

  if (form){
    var FIELD_IDS = ['name', 'phone', 'email', 'service', 'message'];
    var submitBtn = form.querySelector('button[type="submit"]');
    var submitting = false;

    var setFieldValidity = function(id, ok){
      var input = document.getElementById(id);
      if (!input) return;
      var field = input.closest('.field');
      if (field) field.classList.toggle('invalid', !ok);
      input.setAttribute('aria-invalid', ok ? 'false' : 'true');
    }

    var validateAll = function(){
      var valid = true;
      var firstInvalid = null;
      FIELD_IDS.forEach(function(id){
        var input = document.getElementById(id);
        if (!input) return;
        var ok = input.checkValidity();
        setFieldValidity(id, ok);
        if (!ok){
          valid = false;
          if (!firstInvalid) firstInvalid = input;
        }
      });
      return { valid: valid, firstInvalid: firstInvalid };
    }

    var showSummary = function(message){
      if (!summary) return;
      summary.textContent = message;
      summary.hidden = false;
    }
    var hideSummary = function(){
      if (!summary) return;
      summary.hidden = true;
      summary.textContent = '';
    }

    var setStatus = function(message, kind){
      if (!status) return;
      status.textContent = message;
      status.className = 'form-status show' + (kind ? ' ' + kind : '');
    }

    form.addEventListener('submit', function(e){
      e.preventDefault();
      if (submitting) return; /* duplicate-submission guard */

      hideSummary();

      var result = validateAll();

      /* Honeypot check — if this hidden field has a value, silently drop
         as bot spam without hitting the network or alarming the (bot)
         "user" that anything was detected. */
      var hp = document.getElementById('website');
      if (hp && hp.value){
        setStatus(t('form.status_ok'), 'ok');
        form.reset();
        if (loadedAtField) loadedAtField.value = String(Date.now());
        return;
      }

      if (!result.valid){
        showSummary(t('form.status_invalid'));
        setStatus(t('form.status_invalid'), 'error');
        if (result.firstInvalid) result.firstInvalid.focus();
        return;
      }

      if (typeof navigator !== 'undefined' && navigator.onLine === false){
        setStatus(t('form.status_offline'), 'error');
        return;
      }

      submitting = true;
      setStatus(t('form.status_sending'), '');
      if (submitBtn) submitBtn.disabled = true;

      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function(){ controller.abort(); }, 15000) : null;

      fetch('assets/contact-handler.php', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: new FormData(form),
        signal: controller ? controller.signal : undefined
      })
        .then(function(res){
          if (timeoutId) clearTimeout(timeoutId);
          var contentType = res.headers.get('Content-Type') || '';
          var parse = contentType.indexOf('application/json') !== -1
            ? res.json().catch(function(){ return null; })
            : Promise.resolve(null);
          return parse.then(function(data){ return { res: res, data: data }; });
        })
        .then(function(result){
          var res = result.res, data = result.data;

          if (res.ok && data && data.ok){
            setStatus(t('form.status_ok'), 'ok');
            hideSummary();
            form.reset();
            FIELD_IDS.forEach(function(id){ setFieldValidity(id, true); });
            if (loadedAtField) loadedAtField.value = String(Date.now());
            return;
          }

          if (res.status === 429){
            setStatus(t('form.status_rate_limited'), 'error');
            return;
          }

          if (res.status === 422 && data && Array.isArray(data.fields) && data.fields.length){
            var firstBad = null;
            data.fields.forEach(function(name){
              if (FIELD_IDS.indexOf(name) === -1) return;
              setFieldValidity(name, false);
              if (!firstBad) firstBad = document.getElementById(name);
            });
            showSummary(t('form.status_invalid'));
            setStatus(t('form.status_invalid'), 'error');
            if (firstBad) firstBad.focus();
            return;
          }

          if (res.status >= 500){
            setStatus(t('form.status_error'), 'error');
            return;
          }

          /* Any other non-success status (403 origin check, unexpected
             field rejected, malformed/non-JSON response, etc.) — generic,
             non-revealing error message. Values are preserved either way. */
          setStatus(t('form.status_error'), 'error');
        })
        .catch(function(err){
          if (timeoutId) clearTimeout(timeoutId);
          if (err && err.name === 'AbortError'){
            setStatus(t('form.status_timeout'), 'error');
          } else if (typeof navigator !== 'undefined' && navigator.onLine === false){
            setStatus(t('form.status_offline'), 'error');
          } else {
            setStatus(t('form.status_error'), 'error');
          }
        })
        .finally(function(){
          submitting = false;
          if (submitBtn) submitBtn.disabled = false;
        });
    });

    form.querySelectorAll('input,textarea,select').forEach(function(input){
      input.addEventListener('blur', function(){
        if (FIELD_IDS.indexOf(input.id) === -1) return;
        setFieldValidity(input.id, input.checkValidity());
      });
    });
  }
})();
