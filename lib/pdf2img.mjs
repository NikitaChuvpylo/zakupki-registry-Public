// Рендер PDF в PNG через mupdf (wasm)
import fs from 'fs';
import path from 'path';
import * as mupdf from 'mupdf';

/**
 * Рендерит все страницы PDF в PNG-файлы.
 * @param {string} pdfPath - путь к PDF
 * @param {string} outDir - куда класть PNG
 * @param {number} scale - масштаб (3.5 = ~250dpi — хороший компромисс для OCR)
 * @returns {Promise<string[]>} массив путей к PNG
 */
export async function pdfToImages(pdfPath, outDir, scale = 3.5) {
  fs.mkdirSync(outDir, { recursive: true });
  const buf = fs.readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  const n = doc.countPages();
  const paths = [];
  try {
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i);
      const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
      const png = pix.asPNG();
      const out = path.join(outDir, `page_${String(i + 1).padStart(3, '0')}.png`);
      fs.writeFileSync(out, png);
      paths.push(out);
      page.destroy();
      pix.destroy();
    }
  } finally {
    doc.destroy();
  }
  return paths;
}

export async function pdfPageCount(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  const n = doc.countPages();
  doc.destroy();
  return n;
}
