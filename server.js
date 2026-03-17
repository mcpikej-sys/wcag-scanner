const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');  // Node built-in for fallback download

const app = express();
const PORT = process.env.PORT || 3000;  // Render assigns port

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// AUTO-DOWNLOAD axe.min.js if missing (Render-safe)
if (!fs.existsSync('./axe.min.js')) {
  console.log('📥 Downloading axe.min.js...');
  https.get('https://cdn.jsdelivr.net/npm/axe-core@4.9.1/axe.min.js', (res) => {
    const file = fs.createWriteStream('axe.min.js');
    res.pipe(file);
    file.on('finish', () => console.log('✅ axe.min.js downloaded'));
  }).on('error', (err) => console.error('⚠️ axe download failed:', err.message));
}

app.post('/scan', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  let browser;
  try {
    console.log('🚀 Launching Puppeteer...');
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',  // Render fix
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--single-process',  // Low RAM on free tier
        '--no-zygote',
        '--no-first-run'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined  // Render auto-sets
    });
    const page = await browser.newPage();
    
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('🌐 Loading:', url);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });

    console.log('⏳ Waiting...');
    await new Promise(r => setTimeout(r, 1500));

    // Wait for axe.min.js (if auto-downloading)
    await new Promise(r => setTimeout(r, 2000));

    console.log('🔍 Injecting axe-core...');
    await page.addScriptTag({ path: './axe.min.js' });

    console.log('⚡ Running WCAG scan...');
    const results = await page.evaluate(() => {
      const options = {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        reporter: 'v1'
      };
      return window.axe.run(document, options);
    });

    console.log(`✅ Scan: ${results.violations.length} violations`);
    await browser.close();
    res.json({ violations: results.violations });
  } catch (error) {
    console.error('💥 Scan error:', error.message);
    if (browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🎉 WCAG Scanner: http://localhost:${PORT}`);
});