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
  // Check for env vars first (production)
  if (process.env.P12_BASE64 && process.env.WWDR_PEM) {
    return true;
  }
  
  // Fall back to files (local dev)
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
  
  // Check for env vars first (production)
  if (process.env.P12_BASE64 && process.env.WWDR_PEM) {
    p12Buffer = Buffer.from(process.env.P12_BASE64, 'base64');
    wwdrPem = process.env.WWDR_PEM;
  } else {
    // Fall back to files (local dev)
    p12Buffer = fs.readFileSync(path.join(CERTS_PATH, 'pass.p12'));
    wwdrPem = fs.readFileSync(path.join(CERTS_PATH, 'wwdr.pem'), 'utf8');
  }
  
  // Extract cert and key from p12 using node-forge
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

// Generate a pass
app.post('/api/generate-pass', async (req, res) => {
  try {
    const { text, color, drawingDataUrl } = req.body;
    
    if (!checkCerts()) {
      return res.status(500).json({ error: 'Server certificates not configured' });
    }

    const { certPem, keyPem, wwdrPem } = getCertificates();

    // Create pass from template
    const pass = await PKPass.from({
      model: TEMPLATE_PATH,
      certificates: {
        wwdr: wwdrPem,
        signerCert: certPem,
        signerKey: keyPem,
      }
    });

    // Update pass fields
    pass.serialNumber = `memo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    pass.backgroundColor = getBackgroundColor(color);
    
    if (pass.primaryFields && pass.primaryFields[0]) {
      pass.primaryFields[0].value = text || 'Empty note';
    }

    // Generate and add images
    // For eventTicket passes, background.png shows behind entire card
    const backgroundBuffer = await generateBackgroundImage(color, drawingDataUrl);
    const iconBuffer = await generateIconImage(color);
    const logoBuffer = await generateLogoImage();

    pass.addBuffer('background.png', backgroundBuffer);
    pass.addBuffer('background@2x.png', backgroundBuffer);
    pass.addBuffer('icon.png', iconBuffer);
    pass.addBuffer('icon@2x.png', iconBuffer);
    pass.addBuffer('logo.png', logoBuffer);
    pass.addBuffer('logo@2x.png', logoBuffer);

    // Generate the .pkpass file
    const passBuffer = pass.getAsBuffer();

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

// Color mapping for pass background
function getBackgroundColor(color) {
  const colors = {
    blue: 'rgb(157, 213, 238)',    // Match gradient base
    yellow: 'rgb(226, 208, 96)',
    pink: 'rgb(228, 184, 192)'
  };
  return colors[color] || colors.blue;
}

// Generate the background image with gradient and paper texture
// For eventTicket passes: 180x220 @1x, 360x440 @2x
async function generateBackgroundImage(color, drawingDataUrl) {
  const width = 360;
  const height = 440;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Gradient colors matching the site's sticky note SVG (bottom to top)
  const gradientColors = {
    blue: [
      { pos: 0, color: '#7AC0DC' },      // darker at bottom
      { pos: 0.3, color: '#9DD5EE' },
      { pos: 0.6, color: '#A8DCF0' },
      { pos: 0.85, color: '#B8E3F3' },
      { pos: 1, color: '#D0F0FA' }       // lighter at top
    ],
    yellow: [
      { pos: 0, color: '#C4B43A' },      // darker at bottom
      { pos: 0.3, color: '#D4C44A' },
      { pos: 0.6, color: '#E2D060' },
      { pos: 0.85, color: '#EFDE7C' },
      { pos: 1, color: '#FAF0A0' }       // lighter at top
    ],
    pink: [
      { pos: 0, color: '#C8909A' },      // darker at bottom
      { pos: 0.3, color: '#D9A8B2' },
      { pos: 0.6, color: '#E4B8C0' },
      { pos: 0.85, color: '#EEC8D0' },
      { pos: 1, color: '#F8E0E8' }       // lighter at top
    ]
  };

  // Create vertical gradient (bottom to top, so we reverse y)
  const gradient = ctx.createLinearGradient(0, height, 0, 0);
  const stops = gradientColors[color] || gradientColors.blue;
  stops.forEach(stop => {
    gradient.addColorStop(stop.pos, stop.color);
  });
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Add subtle paper noise texture
  const noiseIntensity = 0.04;
  ctx.globalAlpha = noiseIntensity;
  for (let i = 0; i < 8000; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const shade = Math.random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade})`;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;

  // Overlay any drawing from the user
  if (drawingDataUrl) {
    try {
      const drawingImage = await loadImage(Buffer.from(drawingDataUrl.split(',')[1], 'base64'));
      ctx.drawImage(drawingImage, 0, 0, width, height);
    } catch (e) {
      console.log('Could not load drawing:', e.message);
    }
  }

  return canvas.toBuffer('image/png');
}

async function generateLogoImage() {
  const width = 160;
  const height = 50;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);
  
  // Use Caveat font for logo too if available
  const fontFamily = GlobalFonts.has('Caveat') ? 'Caveat' : 'sans-serif';
  ctx.font = `600 24px "${fontFamily}"`;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillText('Wallet Memo', 5, 34);

  return canvas.toBuffer('image/png');
}

async function generateIconImage(color) {
  const size = 87;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Use gradient for icon too
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

  // Draw a simple memo line icon
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  
  // Three horizontal lines for "memo" look
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

app.get('/api/health', (req, res) => {
  const certsOk = checkCerts();
  res.json({ 
    status: certsOk ? 'ready' : 'missing-certs',
    message: certsOk ? 'Server ready to generate passes' : 'Please configure certificates'
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`\n🎫 Wallet Memo backend running on http://localhost:${PORT}`);
  console.log('\nChecking certificates...');
  if (checkCerts()) {
    console.log('✅ Certificates found - ready to generate passes!\n');
  } else {
    console.log('\n📋 For local dev: add certs to backend/certs/');
    console.log('📋 For production: set P12_BASE64, WWDR_PEM, P12_PASSWORD env vars\n');
  }
});
