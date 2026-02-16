/**
 * Descarga logos de marcas: Clearbit (logo grande) o Google Favicon (fallback)
 * Ejecutar: node scripts/download-logos.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const BRANDS = [
  { key: 'mercadona', domain: 'mercadona.es' },
  { key: 'carrefour', domain: 'carrefour.es' },
  { key: 'lidl', domain: 'lidl.es' },
  { key: 'ikea', domain: 'ikea.com' },
  { key: 'amazon', domain: 'amazon.es' },
  { key: 'uber', domain: 'uber.com' },
  { key: 'jysk', domain: 'jysk.es' },
  { key: 'douglas', domain: 'douglas.es' },
  { key: 'primor', domain: 'primor.eu' },
  { key: 'notino', domain: 'notino.es' },
  { key: 'uniqlo', domain: 'uniqlo.com' },
  { key: 'leroy-merlin', domain: 'leroymerlin.es' },
  { key: 'cursor', domain: 'cursor.com' },
  { key: 'burger-king', domain: 'burgerking.es' },
  { key: 'kinepolis', domain: 'kinepolis.es' },
  { key: 'easypark', domain: 'easypark.com' },
  { key: 'amovens', domain: 'amovens.com' },
  { key: 'revolut', domain: 'revolut.com' },
  { key: 'kraken', domain: 'kraken.com' },
  { key: 'siemens', domain: 'siemens.com' },
];

const OUT_DIR = path.join(__dirname, '../public/icons');

const SOURCES = [
  { name: 'Clearbit', url: (d) => `https://logo.clearbit.com/${d}` },
  { name: 'Google Favicon', url: (d) => `https://www.google.com/s2/favicons?domain=${d}&sz=128` },
];

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BankaApp/1.0)' } }, (res) => {
      if (res.statusCode === 200) {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      } else {
        reject(new Error(`${res.statusCode}`));
      }
    }).on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  for (const { key, domain } of BRANDS) {
    const ext = 'png';
    const outPath = path.join(OUT_DIR, `${key}.${ext}`);
    let ok = false;

    for (const src of SOURCES) {
      const url = typeof src.url === 'function' ? src.url(domain) : src.url;
      try {
        const buf = await download(url);
        if (buf && buf.length > 100) {
          fs.writeFileSync(outPath, buf);
          console.log(`OK ${key} <- ${src.name} (${domain})`);
          ok = true;
          break;
        }
      } catch (e) {
        // try next source
      }
    }
    if (!ok) {
      console.log(`FAIL ${key} (${domain}): ninguna fuente disponible`);
    }
  }
}

main();
