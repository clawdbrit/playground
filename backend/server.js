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
const BUILD_NUMBER = 55;

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
    console.log('Received - text:', text, 'color:', color, 'drawing length:', drawingDataUrl?.length);
    
    if (!checkCerts()) {
      return res.status(500).json({ error: 'Server certificates not configured' });
    }

    const { certPem, keyPem, wwdrPem } = getCertificates();

    // Get background color based on selection
    const bgColor = getBackgroundColor(color);
    console.log('Creating pass with color:', color, 'bgColor:', bgColor);
    
    // Read and modify the pass.json template to set the correct color
    const passJsonPath = path.join(TEMPLATE_PATH, 'pass.json');
    const passJsonContent = JSON.parse(fs.readFileSync(passJsonPath, 'utf8'));
    passJsonContent.backgroundColor = bgColor;
    
    // Write modified pass.json temporarily
    fs.writeFileSync(passJsonPath, JSON.stringify(passJsonContent, null, 2));
    
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
    
    // Set build number in back field (flip side of pass)
    if (pass.backFields && pass.backFields[0]) {
      pass.backFields[0].value = String(BUILD_NUMBER);
    }
    
    // Add memo text to secondary field (smaller, less dominant)
    if (text && text.trim() && pass.secondaryFields && pass.secondaryFields[0]) {
      pass.secondaryFields[0].value = text;
      console.log('Set memo in secondaryFields:', text);
    }

    // Generate and add images
    // For eventTicket passes, strip.png shows CRISP at top (not blurred like background)
    console.log('Drawing data received:', drawingDataUrl ? 'yes (' + drawingDataUrl.length + ' chars)' : 'no');
    const stripBuffer = await generateStripImage(color, drawingDataUrl);
    const iconBuffer = await generateIconImage(color);

    // Generate background image (fills entire pass body)
    const bgBuffer = await generateBackgroundImage(color);
    
    pass.addBuffer('strip.png', stripBuffer);
    pass.addBuffer('strip@2x.png', stripBuffer);
    pass.addBuffer('strip@3x.png', stripBuffer);
    // Removing background to see if it conflicts with strip
    // pass.addBuffer('background.png', bgBuffer);
    // pass.addBuffer('background@2x.png', bgBuffer);
    pass.addBuffer('icon.png', iconBuffer);
    pass.addBuffer('icon@2x.png', iconBuffer);
    // Logo removed per user request

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

// Generate the strip image with gradient, text, and drawing
// Apple crops strip to ~123 points (369px @3x) for eventTicket
// We'll make it 450px tall and position drawing at TOP so it's visible
async function generateStripImage(color, drawingDataUrl) {
  const width = 1125;  // @3x width
  const height = 450;  // Slightly taller than Apple's crop, drawing at top
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Gradient colors - more dramatic contrast for visible effect
  const gradientColors = {
    blue: [
      { pos: 0, color: '#9DD5EE' },      // bottom matches backgroundColor
      { pos: 0.5, color: '#B8E8F8' },
      { pos: 1, color: '#E0F5FC' }       // lighter at top (like light source)
    ],
    yellow: [
      { pos: 0, color: '#E2D060' },      // bottom matches backgroundColor
      { pos: 0.5, color: '#F0E480' },
      { pos: 1, color: '#FDF8C0' }       // lighter at top
    ],
    pink: [
      { pos: 0, color: '#E4B8C0' },      // bottom matches backgroundColor
      { pos: 0.5, color: '#F0C8D0' },
      { pos: 1, color: '#FCE8F0' }       // lighter at top
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

  // Skip paper noise for now - causes visible seam with background
  // TODO: Add noise back but fade it out at the bottom edge

  // Text now rendered via pass fields (primaryFields) for guaranteed visibility
  // Strip is just for the drawing/visual

  // Overlay any drawing from the user (skip if too small - likely empty canvas)
  console.log('Drawing data length:', drawingDataUrl ? drawingDataUrl.length : 0);
  if (drawingDataUrl && drawingDataUrl.length > 1000) {
    try {
      console.log('Processing drawing...');
      const drawingImage = await loadImage(Buffer.from(drawingDataUrl.split(',')[1], 'base64'));
      console.log('Drawing loaded:', drawingImage.width, 'x', drawingImage.height);
      
      // Scale to FILL (cover entire canvas) rather than FIT
      // This minimizes scaling down, which preserves line sharpness
      const srcAspect = drawingImage.width / drawingImage.height;
      const dstAspect = width / height;
      
      let drawWidth, drawHeight, drawX, drawY;
      
      // Scale drawing to FIT within strip (contain, not cover)
      // This ensures the entire drawing is visible
      if (srcAspect > (width / height)) {
        // Drawing is wider - fit to width
        drawWidth = width * 0.9;  // 90% width for margin
        drawHeight = drawWidth / srcAspect;
      } else {
        // Drawing is taller - fit to height
        drawHeight = height * 0.9;  // 90% height for margin
        drawWidth = drawHeight * srcAspect;
      }
      // Center the drawing
      drawX = (width - drawWidth) / 2;
      drawY = (height - drawHeight) / 2;
      
      ctx.drawImage(drawingImage, drawX, drawY, drawWidth, drawHeight);
      console.log('Drawing applied successfully');
    } catch (e) {
      console.error('Could not load drawing:', e.message, e.stack);
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

// Generate background image that fills the pass body
async function generateBackgroundImage(color) {
  // Background image for generic pass: 360x440 @2x = 720x880
  const width = 720;
  const height = 880;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const bgColors = {
    blue: '#A8D4E8',
    yellow: '#E2D060',
    pink: '#E4B8C0'
  };
  ctx.fillStyle = bgColors[color] || bgColors.blue;
  ctx.fillRect(0, 0, width, height);

  // Skip paper texture on background to save memory
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
