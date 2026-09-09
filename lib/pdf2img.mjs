// Рендер PDF в PNG через MuPDF.
// Повышенное качество для OCR.

import fs from 'fs';
import path from 'path';
import * as mupdf from 'mupdf';

/**
 * Рендерит страницы PDF в PNG.
 *
 * scale = 4.2 примерно соответствует 300 DPI
 * и даёт Tesseract больше информации для чтения
 * мелкого текста и таблиц.
 */
export async function pdfToImages(
  pdfPath,
  outDir,
  scale = 4.2
) {
  fs.mkdirSync(
    outDir,
    { recursive: true }
  );

  const buf = fs.readFileSync(
    pdfPath
  );

  const doc =
    mupdf.Document.openDocument(
      buf,
      'application/pdf'
    );

  const pageCount =
    doc.countPages();

  const paths = [];

  try {
    for (
      let i = 0;
      i < pageCount;
      i++
    ) {
      const page =
        doc.loadPage(i);

      const matrix =
        mupdf.Matrix.scale(
          scale,
          scale
        );

      const pix =
        page.toPixmap(
          matrix,
          mupdf.ColorSpace.DeviceRGB,
          false,
          true
        );

      const png =
        pix.asPNG();

      const out =
        path.join(
          outDir,
          `page_${String(i + 1).padStart(3, '0')}.png`
        );

      fs.writeFileSync(
        out,
        png
      );

      paths.push(out);

      page.destroy();
      pix.destroy();
    }
  } finally {
    doc.destroy();
  }

  return paths;
}


export async function pdfPageCount(
  pdfPath
) {
  const buf =
    fs.readFileSync(pdfPath);

  const doc =
    mupdf.Document.openDocument(
      buf,
      'application/pdf'
    );

  const n =
    doc.countPages();

  doc.destroy();

  return n;
}
