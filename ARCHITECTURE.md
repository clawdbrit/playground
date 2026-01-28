# Wallet Memo - Project Architecture

## Overview

Wallet Memo is a web app that lets users create sticky note-style passes for Apple Wallet.

---

## Infrastructure

### Frontend
- **Repo:** `britonbaker/sandbox` (branch: `experiment/coupon-pass-type`)
- **Hosting:** GitHub Pages
- **URL:** https://walletmemo.com
- **Auto-deploy:** Yes, on push to branch

### Backend
- **Repo:** Same repo, `/backend` folder
- **Hosting:** Railway
- **URL:** `https://sandbox-staging.up.railway.app`
- **Auto-deploy:** Yes, on push (from GitHub)

> ⚠️ **Note:** The Railway URL says "staging" but this IS our production backend. 
> We may rename this later for clarity.

### Railway Project Details
- **Project name:** heartfelt-enjoyment
- **Service name:** sandbox
- **Region:** us-west2
- **Plan:** Trial (29 days remaining as of Jan 27, 2026)

---

## How It Works

```
┌─────────────────────┐         ┌──────────────────────────────┐
│  walletmemo.com     │         │  Railway Backend             │
│  (GitHub Pages)     │         │  sandbox-staging.up.railway  │
├─────────────────────┤         ├──────────────────────────────┤
│                     │         │                              │
│  1. User writes     │  POST   │  2. /api/prepare-pass        │
│     note + draws    │ ──────► │     Stores data, returns     │
│                     │         │     download token           │
│                     │         │                              │
│  3. Browser         │  GET    │  4. /api/download-pass/:token│
│     redirects to    │ ──────► │     Generates .pkpass        │
│     download URL    │         │     Returns file             │
│                     │         │                              │
│  5. Safari opens    │  ◄───── │     (Safari handles .pkpass  │
│     "Add to Wallet" │         │      natively)               │
└─────────────────────┘         └──────────────────────────────┘
```

### Why Two-Step Download?
Safari iOS doesn't handle blob URLs for `.pkpass` files. The two-step flow (POST → token → GET redirect) lets Safari navigate directly to the download URL and handle it natively.

---

## Environment Variables (Railway)

Set these in Railway dashboard → Service → Variables:

| Variable | Description |
|----------|-------------|
| `P12_BASE64` | Base64-encoded `pass.p12` certificate |
| `WWDR_PEM` | Apple WWDR certificate (full PEM text) |
| `P12_PASSWORD` | Password for p12 file (can be empty string) |

---

## Pass Type

Currently using `posterEventTicket` (iOS 17.5+) with `eventTicket` fallback.

- **Pros:** Modern full-bleed poster look
- **Cons:** Background image is blurred (drawings don't show crisp)
- **Event date:** Set to 10 years in future (prevents auto-archive)

---

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Frontend app (sticky note UI, drawing canvas) |
| `style.css` | Styling |
| `backend/server.js` | API server (pass generation, image rendering) |
| `backend/templates/walletmemo.pass/pass.json` | Pass template |
| `backend/fonts/Caveat.ttf` | Handwritten font for pass text |

---

## Local Development

```bash
# Run backend locally
cd backend
npm install
npm start
# Runs on http://localhost:8080

# Frontend
# Just open index.html in browser (update BACKEND_URL to localhost for testing)
```

---

## Deployment

**Frontend:** Push to `experiment/coupon-pass-type` branch → GitHub Pages auto-deploys

**Backend:** Push to same branch → Railway auto-deploys from `/backend` folder

---

## Build Number

Backend has a `BUILD_NUMBER` constant in `server.js`. Increment when making changes to help debug which version is deployed. Visible on pass back side (flip the pass over).

Current: **64**

---

*Last updated: Jan 27, 2026 by RAM*
