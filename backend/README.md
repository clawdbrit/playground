# Wallet Memo Backend

Simple Express server that generates Apple Wallet passes for Wallet Memo.

## Setup

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Add your certificates

You need two files in the `certs/` folder:

#### pass.p12
Your exported certificate from Keychain Access (you already have this as `Certificates.p12`).

```bash
cp ~/Documents/Certificates.p12 backend/certs/pass.p12
```

#### wwdr.pem  
Apple's WWDR (Worldwide Developer Relations) certificate in PEM format.

Convert the .cer you downloaded earlier:
```bash
openssl x509 -in ~/Downloads/"Apple WWDR CA G4.cer" -out backend/certs/wwdr.pem -outform PEM
```

### 3. Set your p12 password

Either set an environment variable:
```bash
export P12_PASSWORD=your_password_here
```

Or edit `server.js` line 43 to use your password directly (not recommended for production).

### 4. Run the server

```bash
npm start
```

Server runs on http://localhost:3007

## API

### POST /api/generate-pass

Generate a .pkpass file.

**Body:**
```json
{
  "text": "Buy oat milk\nText mom",
  "color": "blue",
  "drawingDataUrl": "data:image/png;base64,..."
}
```

**Response:** Binary .pkpass file

### GET /api/health

Check if server is ready.

## Security Notes

- Never commit your .p12 or .pem files (they're in .gitignore)
- In production, use environment variables for passwords
- Consider rate limiting for public deployment
