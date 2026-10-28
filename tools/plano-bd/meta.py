# Human descriptions, zones, migrations and walkthroughs for the database map (Spanish, for the owner).
TABLES = {
    'users': 'Las cuentas del panel: nombre, correo, rol y secciones (permissions), estado (invitada, activa o desactivada), contraseña cifrada (solo su huella), idioma, apariencia, verificación en dos pasos y fechas clave. Casi todo lo demás apunta aquí.',
    'sessions': 'Cada sesión abierta: la huella de la cookie (nunca la cookie), el token contra falsificaciones (CSRF), último uso y vencimiento; y «Ver como» cuando el propietario mira el panel como otra persona.',
    'user_tokens': 'Enlaces de un solo uso — invitaciones y «restablecer contraseña» —: solo su huella, para qué sirven, cuándo vencen y cuándo se usaron.',
    'login_challenges': 'El paso entre la contraseña y el código de dos pasos: intentos, tipo (aplicación o correo) y el código enviado por correo (solo su huella).',
    'recovery_codes': 'Los códigos de recuperación de la verificación en dos pasos (solo su huella) y cuándo se usó cada uno.',
    'trusted_devices': 'Navegadores recordados 30 días para no pedir el segundo paso (si Seguridad lo permite).',
    'known_devices': 'Dispositivos desde los que entró cada persona, para avisarle si entra desde uno nuevo.',
    'access_requests': '«Pedir acceso»: qué secciones pide alguien, su mensaje, el estado (pendiente, concedida, descartada) y quién respondió.',
    'roles_migration_017': 'Respaldo de la migración a los cuatro roles: el acceso antes y después de cada cuenta movida, para poder revertirla (roles:rollback).',
    'content': 'Los textos del sitio que se cambiaron en el panel (clave × idioma), con quién y cuándo. Lo que no está aquí usa el texto aprobado de fábrica.',
    'media': 'Fotos y el portafolio en PDF: el espacio del sitio donde van, su orden, el archivo generado, sus tamaños y la descripción en español e inglés.',
    'settings': 'Ajustes del sistema en pares clave–valor: última publicación, correo, captcha, respaldos, políticas de seguridad (los secretos van cifrados).',
    'leads': 'Prospectos: cada mensaje del formulario con sus datos, servicio, estado (nuevo → ganado/perdido), monto, responsable, respuestas extra y fechas.',
    'lead_notes': 'Notas y eventos de cada prospecto (cambios de estado o de monto, asignaciones) con su autor.',
    'analytics_daily': 'Estadísticas de visitas: una fila por día × métrica × valor (visitas, origen, dispositivo, idioma, clics). Solo totales, sin datos personales.',
    'analytics_seen': 'Huellas de los visitantes únicos de hoy (con una sal que cambia cada día); se borran al cambiar el día.',
    'support_reports': 'Solicitudes de soporte: quién, tipo, título, descripción, área, página, estado, prioridad, entrega del correo y calificación.',
    'report_messages': 'La conversación de cada solicitud: mensajes de soporte, de la persona y notas internas.',
    'error_log': 'Cada error registrado (crítico, error o advertencia) con su origen, ubicación en el código y referencia; se guarda 180 días.',
    'monitor_runs': 'Cada revisión automática del sitio: si respondió, qué falló y en cuánto tiempo cargó la portada.',
    'site_reports': 'Informes mensuales enviados a los clientes: mes, quién lo envió, a quién, idioma, estado y cifras.',
    'wiki_news_seen': 'Qué «Novedades» de la wiki vio cada persona en el panel (cada una se muestra una vez).',
    'announcements': 'Cada «Aviso al equipo»: cuándo, quién lo envió, qué novedades, el mensaje y a cuántas personas llegó.',
    'news_emailed': 'Qué novedad le llegó a quién por correo y en qué envío: así nadie recibe dos veces la misma.',
    'activity_log': 'La pantalla «Actividad»: quién hizo qué y cuándo; en los textos guarda el valor anterior y el nuevo (hasta 300 caracteres).',
    'rate_limits': 'Contadores contra abusos (intentos de inicio de sesión, envíos, solicitudes) con claves seudonimizadas, nunca correos ni IP a la vista.',
    'schema_migrations': 'Las migraciones aplicadas y cuándo: la base se actualiza sola al publicar una versión nueva.',
}

ZONES = [
    {'id': 'acc', 'name': 'Cuentas y acceso', 'x': 30, 'y': 40, 'w': 300, 'tables': ['sessions', 'user_tokens', 'login_challenges', 'recovery_codes', 'trusted_devices', 'known_devices', 'access_requests', 'roles_migration_017']},
    {'id': 'sys', 'name': 'Sistema', 'x': 30, 'y': 470, 'w': 300, 'tables': ['activity_log', 'rate_limits', 'schema_migrations']},
    {'id': 'cnt', 'name': 'Contenido del sitio', 'x': 430, 'y': 30, 'w': 340, 'tables': ['content', 'media', 'settings']},
    {'id': 'fil', 'name': 'Archivos (fuera de la base)', 'x': 430, 'y': 690, 'w': 340, 'tables': ['wiki.json', 'schema.php'], 'files': True},
    {'id': 'cli', 'name': 'Clientes y resultados', 'x': 870, 'y': 40, 'w': 300, 'tables': ['leads', 'lead_notes', 'analytics_daily', 'analytics_seen']},
    {'id': 'sup', 'name': 'Soporte', 'x': 870, 'y': 290, 'w': 300, 'tables': ['support_reports', 'report_messages']},
    {'id': 'sta', 'name': 'Estado del sitio', 'x': 870, 'y': 460, 'w': 300, 'tables': ['error_log', 'monitor_runs', 'site_reports']},
    {'id': 'wik', 'name': 'Wiki y avisos', 'x': 870, 'y': 665, 'w': 300, 'tables': ['wiki_news_seen', 'announcements', 'news_emailed']},
]

FILES = {
    'wiki.json': 'cms/wiki/wiki.json: las «Novedades» y las categorías de la wiki. Viaja con cada versión; la base solo guarda quién vio o recibió cada novedad.',
    'schema.php': 'cms/content/schema.php: qué textos y espacios de fotos tiene el sitio, con su largo recomendado y máximo. La base guarda solo lo que cambió.',
}

# Relations the database doesn't enforce (they point to files or carry ids as text).
LOGICAL = [
    {'from': 'wiki_news_seen', 'col': 'news_id', 'to': 'wiki.json', 'text': 'el id de una «Novedad» de wiki.json'},
    {'from': 'news_emailed', 'col': 'news_id', 'to': 'wiki.json', 'text': 'el id de una «Novedad» de wiki.json'},
    {'from': 'announcements', 'col': 'news_ids', 'to': 'wiki.json', 'text': 'la lista (JSON) de «Novedades» enviadas'},
    {'from': 'content', 'col': 'key', 'to': 'schema.php', 'text': 'un texto definido en schema.php'},
    {'from': 'media', 'col': 'slot', 'to': 'schema.php', 'text': 'un espacio de foto definido en schema.php'},
    {'from': 'activity_log', 'col': 'target', 'to': 'users', 'text': 'la persona afectada, en las acciones sobre cuentas'},
]

MIGRATIONS = {
    '001_initial': 'La base inicial: cuentas, sesiones, enlaces, textos, fotos, ajustes, soporte, actividad y límites.',
    '002_monitoring': 'Registro de errores para Monitoreo, con el estado de cada alerta enviada.',
    '003_access': 'Acceso por secciones: cada cuenta con lo que puede cambiar.',
    '004_site_report': 'Informe mensual y cada revisión automática del sitio.',
    '005_known_devices': 'Dispositivos conocidos, para avisar de un inicio de sesión desde uno nuevo.',
    '006_tickets': 'Las solicitudes de soporte pasan a tener estado, prioridad y conversación.',
    '007_two_factor': 'Verificación en dos pasos, con códigos de recuperación.',
    '008_value': 'Prospectos con notas, y estadísticas de visitas.',
    '009_monitor_lite': 'El tiempo de carga de la portada en cada revisión.',
    '010_view_as': '«Ver como» para la cuenta propietaria.',
    '011_access_profiles': 'Perfiles de acceso revisados (Estadísticas como sección propia).',
    '012_report_access': 'El informe mensual se divide en versión para clientes y detalle técnico.',
    '013_welcome': 'Bienvenida del primer ingreso (idioma y apariencia).',
    '014_lead_answers': 'Respuestas a las preguntas extra del formulario en cada prospecto.',
    '015_user_management': 'Gestión de usuarios para administradores.',
    '016_automations': 'Pedir acceso, accesos temporales, navegadores recordados y automatizaciones.',
    '017_roles': 'Cuatro roles claros, con respaldo para revertir.',
    '018_device_reset': '«Quitar dispositivos registrados» con un código por correo.',
    '019_wiki': 'Las «Novedades» vistas de la wiki.',
    '020_intro': '«Primeros pasos» recordados en la cuenta.',
    '021_announcements': 'Avisos al equipo por correo.',
}

FLOWS = [
    {'id': 'login', 'name': 'Iniciar sesión con dos pasos', 'steps': [
        (['rate_limits'], 'Primero se cuentan los intentos: muchos seguidos desde el mismo lugar se frenan.'),
        (['users'], 'Se busca la cuenta por su correo y se compara la contraseña con su huella. Debe estar activa.'),
        (['login_challenges'], 'Si tiene dos pasos, queda un desafío de 5 minutos esperando el código (de la aplicación o del correo).'),
        (['trusted_devices', 'recovery_codes'], 'Un navegador recordado se salta este paso; un código de recuperación lo reemplaza.'),
        (['sessions'], 'Se crea la sesión: se guarda solo la huella de la cookie y un token contra falsificaciones.'),
        (['known_devices', 'activity_log'], 'Si el dispositivo es nuevo se avisa por correo; el inicio de sesión queda en Actividad.'),
    ]},
    {'id': 'invite', 'name': 'Invitar a una persona', 'steps': [
        (['users'], 'Quien administra crea la cuenta como «invitada», con su rol y secciones.'),
        (['user_tokens'], 'Se genera el enlace de invitación (72 horas). En la base queda solo su huella.'),
        (['activity_log'], 'La invitación queda en Actividad. El correo sale con el enlace.'),
        (['users', 'sessions'], 'Al aceptar, la persona elige su contraseña: la cuenta pasa a «activa» y entra al panel.'),
    ]},
    {'id': 'text', 'name': 'Cambiar un texto del sitio', 'steps': [
        (['sessions', 'users'], 'El panel comprueba la sesión y que la cuenta tenga «Textos del sitio».'),
        (['schema.php'], 'El texto se valida con su definición: largo recomendado, máximo y sin HTML.'),
        (['content'], 'Se guarda el valor nuevo por idioma, con quién y cuándo.'),
        (['activity_log'], 'Actividad guarda el texto anterior y el nuevo.'),
        (['settings'], 'Se vuelven a generar las páginas públicas y se anota la publicación y la huella de cada archivo.'),
    ]},
    {'id': 'lead', 'name': 'Llega un prospecto', 'steps': [
        (['rate_limits'], 'El formulario del sitio limita los envíos repetidos y pasa el captcha.'),
        (['leads'], 'El mensaje se guarda como prospecto «Nuevo», aunque el correo de aviso falle.'),
        (['users'], 'La automatización le asigna el responsable del servicio elegido y le avisa por correo.'),
        (['lead_notes'], 'Cada cambio de estado, monto o responsable queda en las notas del prospecto.'),
        (['analytics_daily'], 'Estadísticas cuenta el contacto en los totales del día (sin datos personales).'),
    ]},
    {'id': 'access', 'name': 'Pedir acceso a una sección', 'steps': [
        (['access_requests'], 'La persona pide una sección desde «Más secciones»: queda pendiente, con su mensaje.'),
        (['users'], 'Quien administra los usuarios recibe el aviso y responde desde Usuarios.'),
        (['users', 'access_requests'], 'Al conceder, se agregan las secciones a la cuenta y la solicitud se cierra.'),
        (['activity_log'], 'Todo queda en Actividad.'),
    ]},
    {'id': 'support', 'name': 'Una solicitud de soporte', 'steps': [
        (['support_reports'], 'La persona envía la solicitud: tipo, título, descripción, página y captura opcional.'),
        (['report_messages'], 'Soporte responde, pide información o cambia el estado; cada mensaje es una fila.'),
        (['activity_log'], 'Los cambios de estado quedan en Actividad.'),
        (['error_log'], 'Si un correo no sale, queda registrado y se reintenta.'),
    ]},
    {'id': 'news', 'name': 'Novedades y avisos al equipo', 'steps': [
        (['wiki.json'], 'Cada versión trae sus «Novedades» y para quién es cada una.'),
        (['users'], 'Se calcula quién puede usar cada novedad, con su rol y desde cuándo existe su cuenta.'),
        (['wiki_news_seen'], 'Al entrar, cada persona ve sus novedades una vez; se anota que las vio.'),
        (['news_emailed', 'announcements'], 'Con «Avisos al equipo», el propietario las envía por correo: se anota a quién le llegó cada una y el envío.'),
        (['activity_log'], 'El envío queda en Actividad.'),
    ]},
]
