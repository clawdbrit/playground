# Wallet Memo - Architecture & Infrastructure

## Overview

Wallet Memo is a web app that lets users create sticky note-style passes for Apple Wallet.

**Live site:** https://walletmemo.com

---

## Infrastructure Summary

| Component | Platform | Branch | URL |
|-----------|----------|--------|-----|
| Frontend | GitHub Pages | `main` | walletmemo.com |
| Backend | Railway | `main` | sandbox-staging.up.railway.app |

Both deploy automatically when you push to `main`.

---

## GitHub Pages (Frontend)

**Repo:** `britonbaker/sandbox`  
**Branch:** `main`  
**Root:** `/` (repo root)  
**Custom domain:** walletmemo.com  

### Files
- `index.html` — Main app (sticky note UI, drawing canvas)
- `style.css` — Styling
- `CNAME` — Custom domain config

### Deployment
Push to `main` → GitHub Pages auto-deploys → Live in ~1-2 minutes

### Settings location
Repo → Settings → Pages

---

## Railway (Backend)

**Project:** heartfelt-enjoyment  
**Service:** sandbox  
**Branch:** `main`  
**Root Directory:** `/backend`  
**Region:** us-west2  
**URL:** `https://sandbox-staging.up.railway.app`  

> ⚠️ The URL says "staging" but this IS production. Legacy naming.

### Environment Variables
Set in Railway dashboard → Service → Variables:

| Variable | Description |
|----------|-------------|
| `P12_BASE64` | Base64-encoded `pass.p12` certificate |
| `WWDR_PEM` | Apple WWDR certificate (full PEM text) |
| `P12_PASSWORD` | Password for p12 file (can be empty) |

### Deployment
Push to `main` → Railway auto-deploys from `/backend` folder → Live in ~1-2 minutes

### Settings location
Railway dashboard → heartfelt-enjoyment project → sandbox service → Settings

---

## How Pass Generation Works

```
┌─────────────────────┐         ┌──────────────────────────────┐
│  walletmemo.com     │         │  Railway Backend             │
│  (GitHub Pages)     │         │  sandbox-staging.up.railway  │
├─────────────────────┤         ├──────────────────────────────┤
│                     │         │                              │
│  1. User creates    │  POST   │  2. /api/prepare-pass        │
│     note + drawing  │ ──────► │     Stores data temporarily  │
│                     │         │     Returns download token   │
│                     │         │                              │
│  3. Browser         │  GET    │  4. /api/download-pass/:token│
│     redirects to    │ ──────► │     Generates .pkpass file   │
│     download URL    │         │     Signs with Apple certs   │
│                     │         │                              │
│  5. Safari opens    │  ◄───── │     Returns signed pass      │
│     "Add to Wallet" │         │                              │
└─────────────────────┘         └──────────────────────────────┘
```

### Why Two-Step Download?
Safari iOS doesn't handle blob URLs for `.pkpass` files properly. The two-step flow:
1. POST data → get temporary token
2. Redirect browser to GET endpoint with token
3. Safari navigates directly to download URL and handles `.pkpass` natively

---

## Pass Configuration

**Type:** `posterEventTicket` (iOS 17.5+) with `eventTicket` fallback

| Setting | Value | Why |
|---------|-------|-----|
| Event date | 10 years out | Prevents auto-archive |
| Background | Gradient + drawing | Gets blurred by iOS (poster style) |
| Thumbnail | Gradient + drawing | Shows crisp in some views |

### Known limitation
`posterEventTicket` blurs the background image heavily. Drawings appear but are soft/blurred. This is iOS behavior, not a bug.

---

## Build Number

Backend has `BUILD_NUMBER` in `server.js`. Visible on pass back (flip it over).

**Current:** Check server.js for latest

Increment when deploying changes to help debug which version is live.

---

## Local Development

### Backend
```bash
cd backend
npm install
npm start
# Runs on http://localhost:8080
```

### Frontend
Open `index.html` in browser. Update `BACKEND_URL` in the script to `http://localhost:8080` for local testing.

### Certificates (local only)
Place in `backend/certs/`:
- `pass.p12` — Apple signing certificate
- `wwdr.pem` — Apple WWDR certificate

These are gitignored. Production uses environment variables instead.

---

## Common Tasks

### Deploy a change
1. Make changes
2. Commit and push to `main`
3. Both GitHub Pages and Railway auto-deploy
4. Wait ~2 minutes, then test

### Check deployment status
- **GitHub Pages:** Repo → Actions tab (or just visit site)
- **Railway:** Dashboard → Deployments tab

### Debug pass issues
1. Check build number on pass back side
2. Check Railway logs: Dashboard → Service → View logs
3. Test endpoint directly: `curl https://sandbox-staging.up.railway.app/api/health`

---

## File Structure

```
sandbox/
├── index.html          # Frontend app
├── style.css           # Styles
├── CNAME               # Custom domain
├── ARCHITECTURE.md     # This file
├── backend/
│   ├── server.js       # API server
│   ├── railway.json    # Railway config
│   ├── package.json
│   ├── fonts/
│   │   └── Caveat.ttf  # Handwritten font
│   ├── templates/
│   │   └── walletmemo.pass/
│   │       └── pass.json   # Pass template
│   └── certs/          # Local certs (gitignored)
└── assets/             # Images, icons
```

---

*Last updated: Jan 28, 2026 by RAM*
