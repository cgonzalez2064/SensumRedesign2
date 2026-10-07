<?php
// Server-side strings (e-mails). The admin interface's strings live in
// admin/js/i18n/es.js. Placeholders: {name}, {inviter}, {link}, {hours}, {minutes}, {date}, {support}.
return [
    'brand' => 'Sensum Construcciones',
    'product' => 'Administrador de contenido',
    'footer' => 'Este correo fue enviado automáticamente por el Administrador de contenido del sitio sensumconstrucciones.com.',
    'greeting' => 'Hola {name}:',
    'ignore' => 'Si no esperabas este correo, puedes ignorarlo con tranquilidad.',
    'button_fallback' => 'Si el botón no funciona, copia y pega este enlace en tu navegador:',

    'invite.subject' => 'Invitación al Administrador de contenido de Sensum Construcciones',
    'invite.intro' => '{inviter} te invitó a administrar el contenido del sitio web de Sensum Construcciones.',
    'invite.action' => 'Para activar tu cuenta, crea tu contraseña con el siguiente botón. El enlace vence en {hours} horas y solo puede usarse una vez.',
    'invite.button' => 'Crear mi contraseña',

    'reset.subject' => 'Restablece tu contraseña — Sensum Construcciones',
    'reset.intro' => 'Recibimos una solicitud para restablecer la contraseña de tu cuenta del Administrador de contenido.',
    'reset.action' => 'Usa el siguiente botón para crear una contraseña nueva. El enlace vence en {minutes} minutos y solo puede usarse una vez.',
    'reset.button' => 'Crear contraseña nueva',
    'reset.ignore' => 'Si no solicitaste este cambio, ignora este correo: tu contraseña actual seguirá funcionando.',

    'changed.subject' => 'Tu contraseña fue cambiada — Sensum Construcciones',
    'changed.intro' => 'La contraseña de tu cuenta del Administrador de contenido se cambió el {date}.',
    'changed.sessions' => 'Por seguridad, cerramos tu sesión en los demás dispositivos.',
    'changed.notyou' => 'Si no fuiste tú, restablece tu contraseña de inmediato y escribe a {support}.',
];
