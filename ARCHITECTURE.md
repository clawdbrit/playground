# Wallet Memo - Project Architecture

## Overview

Wallet Memo is a web app that lets users create sticky note-style passes for Apple Wallet.

## Components

### 1. Frontend (Static Website)
- **Location:** `/index.html`, `/style.css`
- **Hosted at:** walletmemo.com (via GitHub Pages) ✅ PROVEN
- **What it does:** 
  - Lets users write notes, pick colors, draw on sticky notes
  - Sends request to backend to generate `.pkpass` file
  - Downloads the pass file for user to add to Apple Wallet

### 2. Backend (Node.js API)
- **Location:** `/backend/server.js`
- **What it does:**
  - Receives note text, color, and drawing data
  - Generates Apple Wallet pass images (strip, icon, background)
  - Signs the pass with Apple certificates
  - Returns `.pkpass` file

---

## Current State (as of Jan 27, 2026)

### ✅ PROVEN (verified in code)

| Fact | Evidence |
|------|----------|
| Frontend calls `http://localhost:3007` | Line 747 of index.html |
| Railway config exists in backend | `/backend/railway.json` |
| Backend supports env vars for certs | Commit 7e96036 |
| Certs are NOT in the repo (gitignored) | `/backend/certs/.gitignore` |

### ❓ UNKNOWN (needs verification)

| Question | How to verify |
|----------|---------------|
| Is the backend deployed to Railway? | Check Railway dashboard |
| What's the Railway URL? | Check Railway dashboard |
| Are the certificates configured in Railway? | Check Railway env vars |

### 🔴 PROBLEM

**The frontend at walletmemo.com cannot generate passes right now.**

Why: It tries to call `localhost:3007`, which doesn't exist on the user's device.

---

## How Pass Generation Works

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────┐
│  User's Browser │  ──►    │  Backend API    │  ──►    │ Apple Signs │
│  (walletmemo.com)│         │  (localhost:3007)│         │ the Pass    │
│                 │         │                 │         │             │
│  - Note text    │         │  - Generate     │         │             │
│  - Color        │         │    images       │         │             │
│  - Drawing      │         │  - Create pass  │         │             │
│                 │  ◄──    │  - Sign w/certs │         │             │
│  Downloads      │         │                 │         │             │
│  .pkpass file   │         │                 │         │             │
└─────────────────┘         └─────────────────┘         └─────────────┘
```

---

## To Make It Work

### Option A: Deploy Backend to Railway (Recommended)

1. **Deploy backend to Railway**
   - Go to Railway dashboard
   - Create new project from `/backend` folder
   - Set environment variables:
     - `P12_BASE64` - base64 encoded pass.p12 certificate
     - `WWDR_PEM` - Apple WWDR certificate contents
     - `P12_PASSWORD` - password for p12 file (if any)

2. **Update frontend to use Railway URL**
   - In `index.html` line 747, change:
     ```js
     // FROM:
     fetch('http://localhost:3007/api/generate-pass', ...
     
     // TO:
     fetch('https://YOUR-RAILWAY-URL.railway.app/api/generate-pass', ...
     ```

3. **Push and test**

### Option B: Run Locally (For Testing)

1. On your Mac, run the backend:
   ```bash
   cd backend
   npm install
   npm start
   ```

2. Open `http://localhost:3007` or the local index.html

3. Generate pass (only works from same machine running backend)

---

## Files Explained

| File | Purpose |
|------|---------|
| `index.html` | Main web app (sticky note UI) |
| `style.css` | Styling |
| `backend/server.js` | API that generates passes |
| `backend/railway.json` | Railway deployment config |
| `backend/templates/walletmemo.pass/pass.json` | Pass template |
| `backend/certs/` | Certificates (NOT in repo, gitignored) |

---

## Next Steps

1. **Check Railway dashboard** - Is the backend deployed? What's the URL?
2. **If not deployed** - Deploy it and set env vars for certs
3. **Update frontend** - Point to Railway URL instead of localhost
4. **Test** - Generate a pass from walletmemo.com on your phone

---

*Last updated: Jan 27, 2026 by RAM*
