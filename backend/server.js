const express = require('express');
const cors = require('cors');
const { PKPass } = require('passkit-generator');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const forge = require('node-forge');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Paths
const CERTS_PATH = path.join(__dirname, 'certs');
const TEMPLATE_PATH = path.join(__dirname, 'templates', 'walletmemo.pass');

// Check if certs exist
function checkCerts() {
  const p12Path = path.join(CERTS_PATH, 'pass.p12');
  const wwdrPath = path.join(CERTS_PATH, 'wwdr.pem');
  
  if (!fs.existsSync(p12Path)) {
    console.error('❌ Missing: certs/pass.p12');
    return false;
  }
  if (!fs.existsSync(wwdrPath)) {
    console.error('❌ Missing: certs/wwdr.pem');
    return false;
  }
  return true;
}

// Extract cert and key from p12 using node-forge
function extractFromP12(p12Path, password) {
  const p12Buffer = fs.readFileSync(p12Path);
  const p12Asn1 = forge.asn1.fromDer(p12Buffer.toString('binary'));
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, password);
  
  // Get certificate
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const cert = certBags[forge.pki.oids.certBag][0].cert;
  const certPem = forge.pki.certificateToPem(cert);
  
  // Get private key
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const key = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;
  const keyPem = forge.pki.privateKeyToPem(key);
  
  return { certPem, keyPem };
}

// Generate a pass
app.post('/api/generate-pass', async (req, res) => {
  try {
    const { text, color, drawingDataUrl } = req.body;
    
    if (!checkCerts()) {
      return res.status(500).json({ error: 'Server certificates not configured' });
    }

    const p12Path = path.join(CERTS_PATH, 'pass.p12');
    const wwdrPath = path.join(CERTS_PATH, 'wwdr.pem');
    const password = process.env.P12_PASSWORD || 'walletmemo123';
    
    // Extract cert and key from p12
    const { certPem, keyPem } = extractFromP12(p12Path, password);
    const wwdrBuffer = fs.readFileSync(wwdrPath);

    // Create pass from template
    const pass = await PKPass.from({
      model: TEMPLATE_PATH,
      certificates: {
        wwdr: wwdrBuffer,
        signerCert: certPem,
        signerKey: keyPem,
      }
    });

    // Update pass fields
    pass.serialNumber = `memo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    pass.backgroundColor = getBackgroundColor(color);
    
    // Update the primary field with the note text
    if (pass.primaryFields && pass.primaryFields[0]) {
      pass.primaryFields[0].value = text || 'Empty note';
    }

    // Generate and add images
    const stripBuffer = await generateStripImage(text, color, drawingDataUrl);
    const iconBuffer = await generateIconImage(color);
    const logoBuffer = await generateLogoImage();

    pass.addBuffer('strip.png', stripBuffer);
    pass.addBuffer('strip@2x.png', stripBuffer);
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

// Color mapping
function getBackgroundColor(color) {
  const colors = {
    blue: 'rgb(168, 212, 232)',
    yellow: 'rgb(226, 208, 96)',
    pink: 'rgb(228, 184, 192)'
  };
  return colors[color] || colors.blue;
}

// Generate the main strip image
async function generateStripImage(text, color, drawingDataUrl) {
  const width = 640;
  const height = 246;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background color
  const bgColors = {
    blue: '#A8D4E8',
    yellow: '#E2D060',
    pink: '#E4B8C0'
  };
  ctx.fillStyle = bgColors[color] || bgColors.blue;
  ctx.fillRect(0, 0, width, height);

  // Paper texture
  ctx.globalAlpha = 0.03;
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(Math.random() * width, Math.random() * height, 1, 1);
  }
  ctx.globalAlpha = 1;

  // Draw text
  if (text) {
    ctx.font = '600 28px sans-serif';
    ctx.fillStyle = '#1a1a1a';
    
    const lines = text.split('\n');
    const lineHeight = 36;
    const startY = 50;
    const startX = 40;

    lines.forEach((line, i) => {
      if (i < 5) {
        ctx.fillText(line, startX, startY + (i * lineHeight));
      }
    });
  }

  // Overlay drawing
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

// Generate logo
async function generateLogoImage() {
  const width = 160;
  const height = 50;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = '#333';
  ctx.fillText('Wallet Memo', 5, 32);

  return canvas.toBuffer('image/png');
}

// Generate icon
async function generateIconImage(color) {
  const size = 87;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const bgColors = {
    blue: '#A8D4E8',
    yellow: '#E2D060',
    pink: '#E4B8C0'
  };
  
  ctx.fillStyle = bgColors[color] || bgColors.blue;
  ctx.beginPath();
  ctx.roundRect(4, 4, size - 8, size - 8, 16);
  ctx.fill();

  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(25, 62);
  ctx.lineTo(62, 25);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

// Health check
app.get('/api/health', (req, res) => {
  const certsOk = checkCerts();
  res.json({ 
    status: certsOk ? 'ready' : 'missing-certs',
    message: certsOk ? 'Server ready to generate passes' : 'Please add certificates'
  });
});

const PORT = process.env.PORT || 3007;
app.listen(PORT, () => {
  console.log(`\n🎫 Wallet Memo backend running on http://localhost:${PORT}`);
  console.log('\nChecking certificates...');
  if (checkCerts()) {
    console.log('✅ Certificates found - ready to generate passes!\n');
  } else {
    console.log('\n📋 Add certs to backend/certs/\n');
  }
});
