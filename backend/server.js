const express = require('express');
const cors = require('cors');
const { PKPass } = require('passkit-generator');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const forge = require('node-forge');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// Build number for debugging deploys
const BUILD_NUMBER = 80;

// Temporary storage for pending passes (Safari iOS workaround)
const pendingPasses = new Map();
const PASS_TOKEN_TTL = 5 * 60 * 1000; // 5 minutes

// Register Caveat font for handwritten style
const fontPath = path.join(__dirname, 'fonts', 'Caveat.ttf');
if (fs.existsSync(fontPath)) {
  GlobalFonts.registerFromPath(fontPath, 'Caveat');
  console.log('✅ Caveat font registered');
}

// Paths
const CERTS_PATH = path.join(__dirname, 'certs');
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'walletmemo.pass');

// Check if certs are available (files or env vars)
function checkCerts() {
  if (process.env.P12_BASE64 && process.env.WWDR_PEM) {
    return true;
  }
  const p12Path = path.join(CERTS_PATH, 'pass.p12');
  const wwdrPath = path.join(CERTS_PATH, 'wwdr.pem');
  if (!fs.existsSync(p12Path)) {
    console.error('❌ Missing: certs/pass.p12 or P12_BASE64 env var');
    return false;
  }
  if (!fs.existsSync(wwdrPath)) {
    console.error('❌ Missing: certs/wwdr.pem or WWDR_PEM env var');
    return false;
  }
  return true;
}

// Get certificates (from env vars or files)
function getCertificates() {
  const password = process.env.P12_PASSWORD || '';
  let p12Buffer, wwdrPem;
  
  if (process.env.P12_BASE64 && process.env.WWDR_PEM) {
    p12Buffer = Buffer.from(process.env.P12_BASE64, 'base64');
    wwdrPem = process.env.WWDR_PEM;
  } else {
    p12Buffer = fs.readFileSync(path.join(CERTS_PATH, 'pass.p12'));
    wwdrPem = fs.readFileSync(path.join(CERTS_PATH, 'wwdr.pem'), 'utf8');
  }
  
  const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
  
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const cert = certBags[forge.pki.oids.certBag][0].cert;
  const certPem = forge.pki.certificateToPem(cert);
  
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const key = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;
  const keyPem = forge.pki.privateKeyToPem(key);
  
  return { certPem, keyPem, wwdrPem };
}

// Color mapping
function getBackgroundColor(color) {
  const colors = {
    blue: 'rgb(157, 213, 238)',
    yellow: 'rgb(226, 208, 96)',
    pink: 'rgb(228, 184, 192)'
  };
  return colors[color] || colors.blue;
}

// Core pass generation logic (shared between endpoints)
async function createPass({ text, color, drawingDataUrl }) {
  const { certPem, keyPem, wwdrPem } = getCertificates();
  
  // Read the pass.json template - keep it mostly as-is for poster mode
  const passJsonPath = path.join(TEMPLATE_PATH, 'pass.json');
  const passJsonContent = JSON.parse(fs.readFileSync(passJsonPath, 'utf8'));
  
  // Only change serial number and event name
  passJsonContent.serialNumber = `memo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Use the memo text as the event name for poster display
  if (text && text.trim() && passJsonContent.semantics) {
    passJsonContent.semantics.eventName = text;
  }
  
  // Write modified pass.json temporarily
  fs.writeFileSync(passJsonPath, JSON.stringify(passJsonContent, null, 2));
  
  console.log('Pass JSON for poster mode:', JSON.stringify(passJsonContent, null, 2));
  
  // Create pass from template
  const pass = await PKPass.from({
    model: TEMPLATE_PATH,
    certificates: {
      wwdr: wwdrPem,
      signerCert: certPem,
      signerKey: keyPem,
    }
  });

  pass.serialNumber = `memo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Set build number in back field
  if (pass.backFields && pass.backFields[0]) {
    pass.backFields[0].value = String(BUILD_NUMBER);
  }
  
  // For poster mode, memo text is set via semantics.eventName (already done above)
  // primaryFields are empty for poster layout

  // For poster layout: use all template images (from working passkit-generator example)
  // Template contains: background.png, logo.png, icon.png
  // No image overrides - use exactly what's in the template
  console.log('Using template images for poster mode (background, logo, icon)');

  // Log semantics for debugging
  console.log('Pass semantics:', JSON.stringify(passJsonContent.semantics, null, 2));

  return pass.getAsBuffer();
}

// Generate a pass
app.post('/api/generate-pass', async (req, res) => {
  try {
    const { text, color, drawingDataUrl } = req.body;
    console.log('Received - text:', text, 'color:', color, 'drawing length:', drawingDataUrl?.length);
    
    if (!checkCerts()) {
      return res.status(500).json({ error: 'Server certificates not configured' });
    }

    const passBuffer = await createPass({ text, color, drawingDataUrl });

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': 'attachment; filename=walletmemo.pkpass'
    });
    res.send(passBuffer);

  } catch (error) {
    console.error('Error generating pass:', error);
    res.status(500).json({ error: error.message });
  }
});

// Safari iOS workaround: Two-step download flow
app.post('/api/prepare-pass', (req, res) => {
  try {
    const { text, color, drawingDataUrl } = req.body;
    const token = `${Date.now()}-${Math.random().toString(36).substr(2, 12)}`;
    
    pendingPasses.set(token, {
      text,
      color,
      drawingDataUrl,
      createdAt: Date.now()
    });
    
    // Clean up old tokens
    for (const [key, value] of pendingPasses.entries()) {
      if (Date.now() - value.createdAt > PASS_TOKEN_TTL) {
        pendingPasses.delete(key);
      }
    }
    
    console.log('Prepared pass token:', token);
    res.json({ token });
  } catch (error) {
    console.error('Error preparing pass:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/download-pass/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const passData = pendingPasses.get(token);
    
    if (!passData) {
      return res.status(404).json({ error: 'Pass token expired or invalid. Please try again.' });
    }
    pendingPasses.delete(token);
    
    if (!checkCerts()) {
      return res.status(500).json({ error: 'Server certificates not configured' });
    }

    const passBuffer = await createPass(passData);

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': 'attachment; filename=walletmemo.pkpass'
    });
    res.send(passBuffer);

  } catch (error) {
    console.error('Error downloading pass:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TEST ROUTE: Quick pass generation for local dev
// Visit: http://localhost:8080/test-pass?color=pink&text=Hello
// ============================================
app.get('/test-pass', async (req, res) => {
  try {
    const { text = 'Test Memo', color = 'blue' } = req.query;
    
    console.log('\n🧪 TEST PASS GENERATION');
    console.log('Text:', text);
    console.log('Color:', color);
    
    if (!checkCerts()) {
      return res.status(500).send('❌ Certificates not configured');
    }

    const passBuffer = await createPass({ text, color, drawingDataUrl: null });

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': 'attachment; filename=test-walletmemo.pkpass'
    });
    res.send(passBuffer);
    
    console.log('✅ Test pass generated successfully\n');

  } catch (error) {
    console.error('❌ Test pass error:', error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

// Generate background image for poster event ticket
// Matching passkit-generator example dimensions: 1700 × 1996
async function generateBackgroundImage(color, drawingDataUrl) {
  const width = 1700;   // Match working example
  const height = 1996;  // Match working example
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Gradient colors - soft sticky note gradients
  const gradientColors = {
    blue: [
      { pos: 0, color: '#7BC4E0' },
      { pos: 0.4, color: '#9DD5EE' },
      { pos: 0.7, color: '#B8E8F8' },
      { pos: 1, color: '#E0F5FC' }
    ],
    yellow: [
      { pos: 0, color: '#D4C44A' },
      { pos: 0.4, color: '#E2D060' },
      { pos: 0.7, color: '#F0E480' },
      { pos: 1, color: '#FDF8C0' }
    ],
    pink: [
      { pos: 0, color: '#D9A8B2' },
      { pos: 0.4, color: '#E4B8C0' },
      { pos: 0.7, color: '#F0C8D0' },
      { pos: 1, color: '#FCE8F0' }
    ]
  };

  // Create vertical gradient (bottom darker, top lighter)
  const gradient = ctx.createLinearGradient(0, height, 0, 0);
  const stops = gradientColors[color] || gradientColors.blue;
  stops.forEach(stop => {
    gradient.addColorStop(stop.pos, stop.color);
  });
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Overlay any drawing from the user
  if (drawingDataUrl && drawingDataUrl.length > 1000) {
    try {
      console.log('Processing drawing for background...');
      const drawingImage = await loadImage(Buffer.from(drawingDataUrl.split(',')[1], 'base64'));
      
      // Scale drawing to fit within poster, leaving room for text at bottom
      const srcAspect = drawingImage.width / drawingImage.height;
      let drawWidth, drawHeight, drawX, drawY;
      
      // Leave bottom 25% for text area (where Apple applies blur)
      const availableHeight = height * 0.7;
      
      if (srcAspect > (width / availableHeight)) {
        drawWidth = width * 0.9;
        drawHeight = drawWidth / srcAspect;
      } else {
        drawHeight = availableHeight * 0.9;
        drawWidth = drawHeight * srcAspect;
      }
      
      // Center horizontally, position in upper portion
      drawX = (width - drawWidth) / 2;
      drawY = height * 0.08;  // Start 8% from top
      
      ctx.drawImage(drawingImage, drawX, drawY, drawWidth, drawHeight);
      console.log('Drawing applied to background');
    } catch (e) {
      console.error('Could not load drawing:', e.message);
    }
  }

  return canvas.toBuffer('image/png');
}

async function generateIconImage(color) {
  const size = 87;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, size, 0, 0);
  
  if (color === 'yellow') {
    gradient.addColorStop(0, '#D4C44A');
    gradient.addColorStop(1, '#F5E58A');
  } else if (color === 'pink') {
    gradient.addColorStop(0, '#D9A8B2');
    gradient.addColorStop(1, '#F3D0D8');
  } else {
    gradient.addColorStop(0, '#9DD5EE');
    gradient.addColorStop(1, '#C4E9F5');
  }
  
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(4, 4, size - 8, size - 8, 16);
  ctx.fill();

  // Draw memo lines icon
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  
  ctx.beginPath();
  ctx.moveTo(22, 30);
  ctx.lineTo(65, 30);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(22, 44);
  ctx.lineTo(55, 44);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(22, 58);
  ctx.lineTo(45, 58);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

// Generate logo for poster event ticket
async function generateLogoImage(color) {
  // Logo dimensions: 160x50 @1x (Apple recommendation)
  const width = 320;
  const height = 100;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Transparent background
  ctx.clearRect(0, 0, width, height);
  
  // Small sticky note icon
  const noteSize = 60;
  const noteX = 10;
  const noteY = (height - noteSize) / 2;
  
  const gradient = ctx.createLinearGradient(noteX, noteY + noteSize, noteX, noteY);
  if (color === 'yellow') {
    gradient.addColorStop(0, '#D4C44A');
    gradient.addColorStop(1, '#F5E58A');
  } else if (color === 'pink') {
    gradient.addColorStop(0, '#D9A8B2');
    gradient.addColorStop(1, '#F3D0D8');
  } else {
    gradient.addColorStop(0, '#9DD5EE');
    gradient.addColorStop(1, '#C4E9F5');
  }
  
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(noteX, noteY, noteSize, noteSize, 8);
  ctx.fill();
  
  // Lines on the note
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  
  ctx.beginPath();
  ctx.moveTo(noteX + 12, noteY + 20);
  ctx.lineTo(noteX + noteSize - 12, noteY + 20);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(noteX + 12, noteY + 32);
  ctx.lineTo(noteX + noteSize - 18, noteY + 32);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(noteX + 12, noteY + 44);
  ctx.lineTo(noteX + noteSize - 24, noteY + 44);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

app.get('/api/health', (req, res) => {
  const certsOk = checkCerts();
  res.json({ 
    status: certsOk ? 'ready' : 'missing-certs',
    build: BUILD_NUMBER,
    message: certsOk ? 'Server ready to generate passes' : 'Please configure certificates'
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`\n🎫 Wallet Memo backend running on http://localhost:${PORT}`);
  console.log(`📦 Build: ${BUILD_NUMBER}`);
  console.log(`🧪 Test route: http://localhost:${PORT}/test-pass?color=pink&text=Hello`);
  console.log('\nChecking certificates...');
  if (checkCerts()) {
    console.log('✅ Certificates found - ready to generate passes!\n');
  } else {
    console.log('\n📋 For local dev: add certs to backend/certs/');
    console.log('📋 For production: set P12_BASE64, WWDR_PEM, P12_PASSWORD env vars\n');
  }
});
