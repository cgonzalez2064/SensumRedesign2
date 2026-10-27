---
title: Security (owner account)
summary: Account rules, the encrypted off-server backup and the team's two-step sign-in.
category: administracion
order: 10
icon: shield-lock
owner: true
updated: 2026-10-27
---
In `Security` (Administration) you set the rules for every account.

![Security: accounts, backup and two-step sign-in](shot:seguridad)

## Accounts

| Rule | What it does |
|---|---|
| Turn off unused accounts | Never, or after 90, 120 or 180 days without signing in. We warn 7 days before. The owner account is never turned off. |
| Refuse leaked passwords | Anonymously checks that a new password isn't in known leaks. |
| Allow "Remember this device" | People using two-step sign-in can skip the code for 30 days in a trusted browser. |

## Encrypted off-server backup

The system e-mails, as often as you choose, an encrypted ZIP with the database and photos. Use an e-mail that isn't on this hosting and a backup password of at least 12 characters. `Send backup now` is for testing it.

> [!important] Keep the backup password in a password manager: without it the file can't be opened.

## The team's two-step sign-in

Choose who must use it (only the owner account, also those who administer, the whole team or nobody) and see who has it on. If someone lost or changed their phone, tap `Remove devices` next to their name: when they sign in they confirm a code sent to their e-mail and register the new one.

Every change asks for your password and is kept in the activity.
