// OCR через tesseract.js: страница PNG -> текст (русский)
import path from 'path';
import { createWorker } from 'tesseract.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESS = path.join(__dirname, '..', 'data', 'tessdata');

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('rus', 1, { langPath: TESS });
  }
  return workerPromise;
}

export async function ocrImage(pngPath) {
  const worker = await getWorker();
  const { data } = await worker.recognize(pngPath);
  return data.text || '';
}

export async function terminateWorker() {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}
