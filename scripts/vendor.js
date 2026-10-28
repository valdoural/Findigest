#!/usr/bin/env node
'use strict';
/** Кладёт шрифты, pdf.js и xlsx в src/renderer/digest/vendor — приложение не зависит от CDN. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const V = path.join(ROOT, 'src', 'renderer', 'digest', 'vendor');
fs.mkdirSync(path.join(V, 'fonts'), { recursive: true });

const cp = (from, to) => fs.copyFileSync(path.join(NM, from), path.join(V, to));
cp('pdfjs-dist/build/pdf.min.js', 'pdf.min.js');
cp('pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js');
cp('xlsx/dist/xlsx.full.min.js', 'xlsx.full.min.js');

// Те же начертания, что запрашивала веб-версия: Manrope 400/600/700, IBM Plex Mono 500, Unbounded 500/700
const FONTS = [['manrope', 'Manrope', [400, 600, 700]], ['ibm-plex-mono', 'IBM Plex Mono', [500]], ['unbounded', 'Unbounded', [500, 700]],
  // для вариантов оформления (desktop/skins.css): кириллица, лицензия OFL
  ['golos-text', 'Golos Text', [400, 500, 600, 700]], ['geologica', 'Geologica', [400, 500, 600, 700]]];
const RANGES = {
  latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  cyrillic: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
  'latin-ext': 'U+0100-02AF,U+0304,U+0308,U+0329,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
};
let css = '/* Локальные шрифты (сгенерировано scripts/vendor.js) */\n';
for (const [pkg, family, weights] of FONTS) {
  for (const w of weights) {
    for (const [sub, range] of Object.entries(RANGES)) {
      const file = `${pkg}-${sub}-${w}-normal.woff2`;
      const src = path.join(NM, '@fontsource', pkg, 'files', file);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, path.join(V, 'fonts', file));
      css += `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${w};src:url(fonts/${file}) format('woff2');unicode-range:${range}}\n`;
    }
  }
}
fs.writeFileSync(path.join(V, 'fonts.css'), css);
console.log('vendor готов:', fs.readdirSync(path.join(V, 'fonts')).length, 'файлов шрифтов');
