/**
 * Descarga todos los iconos al proyecto (logos + Iconify).
 * Ejecutar una vez: node scripts/download-all-icons.js
 * Sin peticiones en runtime - todo local en public/icons/
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, '../public/icons');

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

// Iconify: prefix:icon -> archivo prefix-icon.svg
const ICONIFY_ICONS = [
  'mdi:gas-station', 'mdi:highway', 'mdi:parking', 'mdi:bus', 'mdi:home-thermometer',
  'mdi:currency-btc', 'mdi:coffee', 'mdi:food', 'mdi:silverware-fork-knife', 'mdi:cake',
  'mdi:food-variant', 'mdi:rice', 'mdi:party-popper', 'mdi:dumbbell', 'mdi:content-cut',
  'mdi:home', 'mdi:bank', 'mdi:percent', 'mdi:shield-check', 'mdi:heart-pulse',
  'mdi:fire', 'mdi:water', 'mdi:office-building', 'mdi:credit-card-refund', 'mdi:bank-outline',
  'mdi:tshirt-crew-outline', 'mdi:flower', 'mdi:bank-transfer', 'mdi:account-arrow-right', 'mdi:bank-transfer-in',
  'mdi:cart', 'mdi:car', 'mdi:spa', 'mdi:lightning-bolt', 'mdi:cellphone', 'mdi:swap-horizontal',
  'mdi:chart-line', 'mdi:briefcase', 'mdi:tshirt-crew', 'mdi:movie-open', 'mdi:credit-card', 'mdi:store',
];

function download(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BankaApp/1.0)' } }, (res) => {
      const redir = res.headers.location;
      if (redir && res.statusCode >= 300 && res.statusCode < 400) {
        return download(redir.startsWith('http') ? redir : new URL(redir, url).href).then(resolve).catch(reject);
      }
      if (res.statusCode === 200) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      } else {
        reject(new Error(res.statusCode));
      }
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function downloadLogos() {
  const sources = [
    (d) => `https://logo.clearbit.com/${d}`,
    (d) => `https://www.google.com/s2/favicons?domain=${d}&sz=128`,
  ];
  for (const { key, domain } of BRANDS) {
    const outPath = path.join(OUT_DIR, `${key}.png`);
    if (fs.existsSync(outPath)) { console.log('SKIP', key, '(ya existe)'); continue; }
    let ok = false;
    for (const src of sources) {
      try {
        const buf = await download(src(domain));
        if (buf && buf.length > 50) {
          fs.writeFileSync(outPath, buf);
          console.log('OK logo', key);
          ok = true;
          break;
        }
      } catch (_) {}
    }
    if (!ok) console.log('FAIL logo', key);
  }
}

async function downloadIconify() {
  for (const id of ICONIFY_ICONS) {
    const [prefix, icon] = id.split(':');
    const fileName = `${prefix}-${icon}.svg`;
    const outPath = path.join(OUT_DIR, fileName);
    if (fs.existsSync(outPath)) { console.log('SKIP', fileName); continue; }
    const url = `https://api.iconify.design/${prefix}/${icon}.svg?height=40&width=40`;
    try {
      const buf = await download(url);
      if (buf && buf.length > 50) {
        fs.writeFileSync(outPath, buf.toString('utf8'));
        console.log('OK', fileName);
      }
    } catch (e) {
      console.log('FAIL', fileName);
    }
  }
}

const DEFAULT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const defaultPath = path.join(OUT_DIR, 'default.svg');
  if (!fs.existsSync(defaultPath)) {
    fs.writeFileSync(defaultPath, DEFAULT_SVG);
    console.log('OK default.svg (placeholder)');
  }
  console.log('--- Logos ---');
  await downloadLogos();
  console.log('--- Iconos Iconify ---');
  await downloadIconify();
  console.log('Listo. Iconos en', OUT_DIR);
}

main();
