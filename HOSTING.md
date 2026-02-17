# HOSTING.md — Wallet Memo

## Overview

Wallet Memo (walletmemo.com) is a static frontend with a Cloudflare Worker backend.

## Frontend

- **Hosted on:** GitHub Pages (`britonbaker/sandbox`, `main` branch)
- **Live URL:** https://walletmemo.com
- **DNS:** Managed via Cloudflare (DNS-only, grey cloud — GitHub Pages handles SSL)
- **Deploy:** Push to `main` branch → GitHub Pages auto-deploys in ~1–2 min

## Backend (Apple Wallet Pass Generation)

- **Hosted on:** Cloudflare Workers
- **Worker name:** `wallet-worker`
- **Live URL:** https://wallet-api.britonbaker.com
- **Workers.dev URL:** https://wallet-worker.38briton.workers.dev
- **Source:** `~/wallet-worker/` (separate repo/directory from the frontend)
- **Deploy:** `npm run deploy` from `~/wallet-worker/`

### Backend Secrets (stored in Cloudflare Workers dashboard)

| Secret | Description |
|--------|-------------|
| `P12_BASE64` | Base64-encoded Apple Developer pass certificate (.p12) |
| `P12_PASSWORD` | Password for the .p12 certificate |
| `WWDR_PEM` | Apple WWDR (Worldwide Developer Relations) certificate in PEM format |

### KV Namespace

- `PENDING_PASSES` — Stores pass tokens for the Safari iOS two-step download flow
- Namespace ID: `9d5bd16e7bff4440a459cf6fc93a86d3`

## Test Environment

- **Repo:** `clawdbrit/playground`
- **Live URL:** https://clawdbrit.github.io/playground/
- **Deploy:** See `DEPLOY.md` for full push checklist

## DNS Records (on Cloudflare)

| Record | Type | Target | Proxy |
|--------|------|--------|-------|
| walletmemo.com | A | GitHub Pages (185.199.x.x) | DNS only |
| wallet-api.britonbaker.com | CNAME | Auto (via Worker custom domain) | Proxied |

## History

- Originally used a Railway Express server for pass generation
- Migrated backend to Cloudflare Workers (`wallet-worker`) for better performance and zero cost
- Railway project can be decommissioned
