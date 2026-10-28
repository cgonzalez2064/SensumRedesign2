---
title: Monitoring (owner account)
summary: The technical detail: automatic checks, errors, the site's files and alerts.
category: administracion
order: 11
icon: activity
owner: true
updated: 2026-10-27
---
`Monitoring` is the full version of the site's health, for the owner account only.

![Monitoring: checks, trends and errors](shot:monitoreo)

- **Automatic checks:** the site, the panel, the certificate, the domain, e-mail and backups are checked by themselves. Each failure becomes an incident.
- **Trends:** availability, response time and errors per day.
- **Error log:** the site's and the panel's errors, without personal data.
- **Site files:** if a published file changes without an update, it shows here to be reviewed.
- **Automatic alerts:** which addresses get the critical notices and the summary.

> [!note] People with "Site health" see a summary version, without error messages or settings.

## If "The scheduled check stopped running" arrives

The checks, alerts and automations (reminders, the leads summary) depend on a scheduled task on the server that runs every 15 minutes. If it stops, you get that e-mail once a day. To fix it, in cPanel → **Terminal**:

1. "php ~/sensum-cms/bin/console cron" shows whether the task is missing, when it last ran and the last error.
2. "php ~/sensum-cms/bin/console cron:install" creates or repairs it, together with the daily backup, without touching the server's other tasks.
3. "php ~/sensum-cms/bin/console monitor" runs it once right away: the alert stops.

If a step of the check fails, the others still run and the error shows in the log as "A step of the scheduled check failed".
