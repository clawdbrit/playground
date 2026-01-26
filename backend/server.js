const express = require('express');
const cors = require('cors');
const { PKPass } = require('passkit-generator');
const fs = require('fs');
const path = require('path');
const { createCanvas } = require('canvas');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Load certificates
const CERTS_PATH = path.join(__dirname, 'certs');
const PASS_TEMPLATE_PATH = path.join(__dirname, 'pass-template', 'walletmemo.pass');

// Check if certs exist
function checkCerts() {
  const p12Path = path.join(CERTS_PATH, 'pass.p12');
  const wwdrPath = path.join(CERTS_PATH, 'wwdr.pem');
  
  if (!fs.existsSync(p12Path)) {
    console.error('❌ Missing: certs/pass.p12 - Export your certificate from Keychain Access');
    return false;
  }
  if (!fs.existsSync(wwdrPath)) {
    console.error('❌ Missing: certs/wwdr.pem - Download WWDR certificate from Apple');
    return false;
  }
  return true;
}

// Generate a pass
app.post('/api/generate-pass', async (req, res) => {
  try {
    const { text, color, drawingDataUrl } = req.body;
    
    if (!checkCerts()) {
      return res.status(500).json({ error: 'Server certificates not configured' });
    }

    // Read certificates
    const p12Buffer = fs.readFileSync(path.join(CERTS_PATH, 'pass.p12'));
    const wwdrBuffer = fs.readFileSync(path.join(CERTS_PATH, 'wwdr.pem'));

    // Create pass
    const pass = new PKPass({}, {
      wwdr: wwdrBuffer,
      signerCert: p12Buffer,
      signerKey: p12Buffer,
      signerKeyPassphrase: process.env.P12_PASSWORD || 'walletmemo123'
    }, {
      formatVersion: 1,
      passTypeIdentifier: 'pass.com.walletmemo.note',
      teamIdentifier: process.env.TEAM_ID || 'HTWS8J5HF3', // Your team ID
      organizationName: 'Wallet Memo',
      description: 'A sticky note for your wallet',
      serialNumber: `memo-${Date.now()}`,
      foregroundColor: 'rgb(0, 0, 0)',
      backgroundColor: getBackgroundColor(color),
      labelColor: 'rgb(100, 100, 100)',
      generic: {
        primaryFields: [],
        secondaryFields: [],
        auxiliaryFields: [],
        backFields: [
          {
            key: 'note',
            label: 'YOUR NOTE',
            value: text || 'Empty note'
          }
        ]
      }
    });

    // Generate thumbnail image with the note content
    const thumbnailBuffer = await generateNoteImage(text, color, drawingDataUrl);
    pass.addBuffer('thumbnail.png', thumbnailBuffer);
    pass.addBuffer('thumbnail@2x.png', thumbnailBuffer);
    
    // Add icon (required)
    const iconBuffer = await generateIconImage(color);
    pass.addBuffer('icon.png', iconBuffer);
    pass.addBuffer('icon@2x.png', iconBuffer);

    // Add strip image (the main visual on the pass)
    const stripBuffer = await generateStripImage(text, color, drawingDataUrl);
    pass.addBuffer('strip.png', stripBuffer);
    pass.addBuffer('strip@2x.png', stripBuffer);

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

// Generate the main strip image (what shows on the pass)
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

  // Add paper texture effect (subtle noise)
  ctx.globalAlpha = 0.03;
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
    ctx.fillRect(Math.random() * width, Math.random() * height, 1, 1);
  }
  ctx.globalAlpha = 1;

  // Draw text
  if (text) {
    ctx.font = '600 28px Caveat, cursive, sans-serif';
    ctx.fillStyle = '#1a1a1a';
    
    const lines = text.split('\n');
    const lineHeight = 36;
    const startY = 50;
    const startX = 40;

    lines.forEach((line, i) => {
      ctx.fillText(line, startX, startY + (i * lineHeight));
    });
  }

  // Overlay drawing if provided
  if (drawingDataUrl) {
    try {
      const { loadImage } = require('canvas');
      const drawingImage = await loadImage(drawingDataUrl);
      ctx.drawImage(drawingImage, 0, 0, width, height);
    } catch (e) {
      console.log('Could not load drawing:', e.message);
    }
  }

  return canvas.toBuffer('image/png');
}

// Generate thumbnail
async function generateNoteImage(text, color, drawingDataUrl) {
  const width = 180;
  const height = 180;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bgColors = {
    blue: '#A8D4E8',
    yellow: '#E2D060',
    pink: '#E4B8C0'
  };
  ctx.fillStyle = bgColors[color] || bgColors.blue;
  ctx.fillRect(0, 0, width, height);

  // Mini text preview
  if (text) {
    ctx.font = '600 16px sans-serif';
    ctx.fillStyle = '#1a1a1a';
    const preview = text.substring(0, 30) + (text.length > 30 ? '...' : '');
    ctx.fillText(preview, 10, 90);
  }

  return canvas.toBuffer('image/png');
}

// Generate icon
async function generateIconImage(color) {
  const size = 58;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  const bgColors = {
    blue: '#A8D4E8',
    yellow: '#E2D060',
    pink: '#E4B8C0'
  };
  
  // Rounded square
  ctx.fillStyle = bgColors[color] || bgColors.blue;
  const radius = 12;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, radius);
  ctx.fill();

  // Pencil icon hint
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(15, 43);
  ctx.lineTo(43, 15);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

// Health check
app.get('/api/health', (req, res) => {
  const certsOk = checkCerts();
  res.json({ 
    status: certsOk ? 'ready' : 'missing-certs',
    message: certsOk ? 'Server ready to generate passes' : 'Please add certificates to backend/certs/'
  });
});

const PORT = process.env.PORT || 3007;
app.listen(PORT, () => {
  console.log(`\n🎫 Wallet Memo backend running on http://localhost:${PORT}`);
  console.log('\nChecking certificates...');
  if (checkCerts()) {
    console.log('✅ Certificates found - ready to generate passes!\n');
  } else {
    console.log('\n📋 Setup instructions:');
    console.log('1. Copy your Certificates.p12 to backend/certs/pass.p12');
    console.log('2. Convert WWDR cert to PEM and save as backend/certs/wwdr.pem');
    console.log('   (Run: openssl x509 -in "Apple WWDR CA G4.cer" -out wwdr.pem -outform PEM)\n');
  }
});
