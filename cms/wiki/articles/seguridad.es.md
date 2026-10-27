---
title: Seguridad (cuenta propietaria)
summary: Reglas de las cuentas, respaldo cifrado fuera del servidor y verificación en dos pasos del equipo.
category: administracion
order: 10
icon: shield-lock
owner: true
updated: 2026-10-27
---
En `Seguridad` (Administración) defines las reglas para todas las cuentas.

![Seguridad: cuentas, respaldo y verificación en dos pasos](shot:seguridad)

## Cuentas

| Regla | Qué hace |
|---|---|
| Desactivar cuentas sin uso | Nunca, o después de 90, 120 o 180 días sin entrar. Avisamos 7 días antes. La cuenta propietaria nunca se desactiva. |
| Rechazar contraseñas filtradas | Comprueba de forma anónima que una contraseña nueva no aparezca en filtraciones conocidas. |
| Permitir «Recordar este dispositivo» | Quien usa la verificación en dos pasos puede no escribir el código por 30 días en un navegador de confianza. |

## Respaldo cifrado fuera del servidor

El sistema envía por correo, con la frecuencia que elijas, un ZIP cifrado con la base de datos y las fotos. Usa un correo que no esté en este hosting y una contraseña de respaldos de al menos 12 caracteres. `Enviar respaldo ahora` sirve para probarlo.

> [!important] Guarda la contraseña de respaldos en un gestor de contraseñas: sin ella el archivo no se abre.

## Verificación en dos pasos del equipo

Elige a quién se le exige (solo a la cuenta propietaria, también a quienes administran, a todo el equipo o a nadie) y mira quién la tiene activa. Si alguien perdió o cambió el teléfono, toca `Quitar dispositivos` junto a su nombre: al entrar confirmará un código enviado a su correo y registrará el nuevo.

Todos los cambios piden tu contraseña y quedan en la actividad.
