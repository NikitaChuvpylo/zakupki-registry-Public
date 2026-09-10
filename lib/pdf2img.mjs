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

/**
 * Пытается достать «родной» текстовый слой PDF (когда это не скан, а обычный
 * компьютерный документ — экспорт из Word и т.п.). Для таких страниц текст
 * извлекается напрямую — это быстрее и точнее OCR, поэтому OCR для такой
 * страницы можно пропустить.
 * Возвращает массив строк — текст каждой страницы (пустая строка = слоя нет,
 * скорее всего скан, нужен OCR).
 * @param {string} pdfPath
 * @returns {Promise<string[]>}
 */
export async function pdfPageTexts(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  const n = doc.countPages();
  const texts = [];
  try {
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i);
      let text = '';
      try {
        // preserve-whitespace: сохраняет переводы строк, чтобы получить
        // построчный текст, близкий к тому, что даёт OCR (для единого парсера).
        const st = page.toStructuredText('preserve-whitespace');
        text = (st.asText && st.asText()) || '';
        if (st.destroy) st.destroy();
      } catch (e) {
        text = ''; // нет текстового слоя или mupdf не смог его достать — не страшно, пойдём через OCR
      }
      texts.push(text);
      page.destroy();
    }
  } finally {
    doc.destroy();
  }
  return texts;
}

export async function pdfPageCount(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  const n = doc.countPages();
  doc.destroy();
  return n;
}
