# Bandeja AUI · Sincronizador en GitHub Actions

Este repo ejecuta cada 10 minutos el mismo sincronizador que antes corría en la PC:

1. Ejecuta las acciones pendientes que se encolan desde la app (`https://bandeja-aui.pages.dev`).
2. Lee los reclamos abiertos de SUR/AUI (sector 120, "No Cerrados").
3. Sube el resultado a la Cloudflare KV `BANDEJA_AUI` que consume la app.

> **Estado: DESACTIVADO.** SUR/AUI bloquea las IPs de GitHub Actions (timeout en
> http/https) y de Cloudflare (522). Solo responde a IPs de San Luis, Argentina
> (la PC del usuario sale por `45.178.3.39`, AS267882). Por eso el sincronizador
> sigue corriendo en la PC mediante la tarea programada `BandejaAUI-Sync`.
> Este repo se conserva para reutilizarlo si se consigue un VPS con IP argentina
> permitida. El workflow está desactivado manualmente.

## Secretos configurados

En *Settings → Secrets and variables → Actions*:

| Secreto | Descripción |
|---|---|
| `SUR_USER` | Usuario de SUR/AUI |
| `SUR_PASS` | Contraseña de SUR/AUI |
| `CLOUDFLARE_API_TOKEN` | Token con permiso **Account → Workers KV Storage → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | ID de la cuenta de Cloudflare |

## Ejecución manual

Podés forzar una corrida desde la pestaña *Actions* → **Sincronizar bandeja AUI** → *Run workflow*.

## Código

- `sync.mjs`: orquesta acciones + snapshot.
- `functions/api/_sur.js`: login, parseo e inferencia de edificio.
- `functions/api/_acciones.js`: ejecución de acciones en SUR/AUI.
- `wrangler.toml`: binding de la KV.
