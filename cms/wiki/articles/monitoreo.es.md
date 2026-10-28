---
title: Monitoreo (cuenta propietaria)
summary: El detalle técnico: revisiones automáticas, errores, archivos del sitio y alertas.
category: administracion
order: 11
icon: activity
owner: true
updated: 2026-10-27
---
`Monitoreo` es la versión completa de la salud del sitio, solo para la cuenta propietaria.

![Monitoreo: revisiones, tendencias y errores](shot:monitoreo)

- **Revisiones automáticas:** el sitio, el panel, el certificado, el dominio, el correo y los respaldos se revisan solos. Cada falla queda como incidente.
- **Tendencias:** disponibilidad, tiempo de respuesta y errores por día.
- **Registro de errores:** los errores del sitio y del panel, sin datos personales.
- **Archivos del sitio:** si un archivo publicado cambia sin una actualización, aparece aquí para revisarlo.
- **Alertas automáticas:** a qué correos llegan los avisos críticos y el resumen.

> [!note] Las personas con «Salud del sitio» ven una versión resumida, sin mensajes de error ni configuración.

## Si llega «La revisión automática dejó de ejecutarse»

Las revisiones, las alertas y las automatizaciones (recordatorios, resumen de prospectos) dependen de una tarea programada del servidor que corre cada 15 minutos. Si deja de correr, te llega ese correo una vez al día. Para arreglarlo, en cPanel → **Terminal**:

1. «php ~/sensum-cms/bin/console cron» muestra si falta la tarea, cuándo corrió por última vez y el último error.
2. «php ~/sensum-cms/bin/console cron:install» la crea o la corrige, junto con el respaldo diario, sin tocar las demás tareas del servidor.
3. «php ~/sensum-cms/bin/console monitor» la ejecuta una vez al momento: la alerta deja de llegar.

Si un paso de la revisión falla, los demás siguen y el error aparece en el registro como «Falló un paso de la revisión automática».
