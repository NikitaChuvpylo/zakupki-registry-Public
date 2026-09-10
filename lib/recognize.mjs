// OCR-распознавание контракта: страницы -> строки (с кэшем на диск)
// 1) распознаём ВСЕ страницы, запрашивая TSV (координаты слов)
// 2) восстанавливаем визуальные строки таблицы из координат (порядок не теряется)
// 3) сортируем страницы по печатному номеру листа (вверху), если он есть
// 4) парсим спецификацию и реквизиты
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWorker } from 'tesseract.js';
import { parseSpecification } from './parse-spec.js';
import { parseHeader } from './parse-header.js';
import { pdfPageTexts } from './pdf2img.mjs';

// Порог: если родного текста на странице набралось хотя бы столько символов —
// считаем, что это не скан, и используем его вместо OCR (быстрее и точнее).
const NATIVE_TEXT_MIN_LEN = 40;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESS = path.join(__dirname, '..', 'data', 'tessdata');

let workerPromise = null;
function getWorker() {
  if (!workerPromise) workerPromise = createWorker('rus', 1, { langPath: TESS });
  return workerPromise;
}

const jobs = new Map(); // contractId -> job

export function getJob(contractId) {
  return jobs.get(contractId) || null;
}

export function clearJob(contractId) {
  jobs.delete(contractId);
}

// Восстановить «визуальные строки» страницы из TSV (уровень слов).
// Кластеризуем слова ПО ВЕРТИКАЛЬНОЙ БЛИЗОСТИ (центр y), а не по строкам tesseract:
// числа таблицы часто чуть смещены по y и tesseract рвёт одну строку на две.
function buildRowsFromTsv(tsv) {
  if (!tsv) return [];
  const lines = String(tsv).trim().split('\n');
  const words = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length < 12) continue;
    if (parts[0].trim() !== '5') continue; // только слова
    const left = Number(parts[6]) || 0;
    const top = Number(parts[7]) || 0;
    const h = Number(parts[9]) || 1;
    const word = (parts[11] || '').trim();
    if (!word) continue;
    words.push({ left, top, cy: top + h / 2, h, text: word });
  }
  if (!words.length) return [];
  // медианная высота слова — база для порога кластеризации
  const hs = words.map(w => w.h).sort((a, b) => a - b);
  const medH = hs[Math.floor(hs.length / 2)] || 12;
  const threshold = Math.max(medH * 0.8, 8);
  words.sort((a, b) => a.cy - b.cy);
  // кластеры строк
  const clusters = [];
  for (const w of words) {
    if (!clusters.length || w.cy - clusters[clusters.length - 1].cy > threshold) {
      clusters.push({ cy: w.cy, words: [w] });
    } else {
      const c = clusters[clusters.length - 1];
      c.words.push(w);
      c.cy = (c.cy * (c.words.length - 1) + w.cy) / c.words.length; // скользящее среднее
    }
  }
  return clusters
    .map(c => c.words.sort((a, b) => a.left - b.left).map(w => w.text).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Печатный номер листа вверху страницы. Номер часто стоит отдельной строкой вверху
// (иногда с мусором | в начале). Ищем в первых 3 строках страницы.
function printedPageNoFromRows(rows) {
  if (!rows || !rows.length) return null;
  for (let i = 0; i < Math.min(4, rows.length); i++) {
    let s = (rows[i] || '').replace(/[|\s\u00A0]+/g, '').trim();
    // «стр. 5» / «лист 5»
    const m2 = s.match(/(?:стр\.?|лист|страниц[аы]?)\s*[№:.\s]*(\d{1,3})/i);
    if (m2) return { n: parseInt(m2[1], 10), strong: true };
    // голая цифра-строка
    const m = s.match(/^(\d{1,3})$/);
    if (m) {
      const n = parseInt(m[1], 10);
      // номер листа не бывает 1..4 в середине контракта, но и позиции вверху страницы не стоят —
      // поэтому считаем сильным, если число 5..200 (листы документа)
      if (n >= 5 && n <= 300) return { n, strong: true };
    }
  }
  return null;
}

// Сортировка страниц: сначала заголовок спецификации («Приложение/СПЕЦИФИКАЦИЯ»),
// затем страницы с печатным номером листа по возрастанию, страницы без номера — в конец.
function sortPagesByNumber(items) {
  const withNo = items.map((r, idx) => {
    const rowsText = r.rows.slice(0, 5).join('\n'); // только верх страницы
    const isSpecHead = /^\s*СПЕЦИФИКАЦИЯ|^\s*Приложение\s*№\s*1/i.test(rowsText)
      || /\bСПЕЦИФИКАЦИЯ\b/.test(rowsText.slice(0, 200));
    const pno = isSpecHead ? { n: 0, strong: true } : printedPageNoFromRows(r.rows);
    return { ...r, pno, isSpecHead, idx };
  });
  const numbered = withNo.filter(x => x.pno && x.pno.strong);
  const realNums = numbered.filter(x => x.pno.n > 0).length;
  // сортируем, если есть заголовок спецификации или ≥40% страниц с номерами
  const hasHead = withNo.some(x => x.isSpecHead);
  if (hasHead || realNums >= Math.max(2, Math.ceil(items.length * 0.4))) {
    return withNo.slice().sort((a, b) => {
      const na = a.pno ? a.pno.n : 9999;
      const nb = b.pno ? b.pno.n : 9999;
      if (na !== nb) return na - nb;
      // страницы без номера после заголовка — в порядке файла (обычно продолжение)
      if (na === 9999 && nb === 9999) return a.idx - b.idx;
      return a.idx - b.idx;
    });
  }
  return withNo; // порядок файла
}

/**
 * Полное распознавание контракта.
 * @returns job { status, done, total, items, header, pagesSorted }
 */
export async function recognizeContract(contractId, pagesDir, ocrCacheDir, onProgress, pdfPath) {
  if (jobs.has(contractId) && jobs.get(contractId).status === 'running') return jobs.get(contractId);

  const files = fs.existsSync(pagesDir)
    ? fs.readdirSync(pagesDir).filter(f => /^page_\d+\.(png|jpe?g|webp)$/i.test(f)).sort()
    : [];
  const total = files.length;
  if (!total) {
    jobs.set(contractId, { status: 'error', error: 'Нет страниц' });
    return jobs.get(contractId);
  }

  const job = { status: 'running', done: 0, total, items: [], header: {}, pagesSorted: [] };
  jobs.set(contractId, job);
  fs.mkdirSync(ocrCacheDir, { recursive: true });

  // Если это компьютерный PDF (не скан) — попробуем достать текст напрямую,
  // без OCR. Если pdfPath не передан (например, загрузили фото) — просто пусто,
  // тогда всё пойдёт через OCR как раньше.
  let nativeTexts = [];
  if (pdfPath) {
    try {
      nativeTexts = await pdfPageTexts(pdfPath);
    } catch (e) {
      nativeTexts = []; // не получилось — не страшно, работаем через OCR
    }
  }

  const worker = await getWorker();
  await worker.setParameters({ tessedit_pageseg_mode: '6' }); // таблицы: единый блок строк
  const readPage = async (i) => {
    // 1) родной текстовый слой PDF, если страница не скан
    const native = nativeTexts[i];
    if (native && native.replace(/\s+/g, '').length >= NATIVE_TEXT_MIN_LEN) {
      return native.split('\n').map(s => s.trim()).filter(Boolean);
    }
    // 2) OCR (скан либо фото) — с кэшем на диск
    const cache = path.join(ocrCacheDir, `page_${String(i + 1).padStart(3, '0')}.rows`);
    if (fs.existsSync(cache)) {
      return fs.readFileSync(cache, 'utf8').split('\n').filter(Boolean);
    }
    const png = path.join(pagesDir, files[i]);
    // запрашиваем TSV для координат слов
    const { data } = await worker.recognize(png, {}, { text: true, tsv: true });
    const rows = buildRowsFromTsv(data.tsv);
    fs.writeFileSync(cache, rows.join('\n'), 'utf8');
    return rows;
  };

  const raw = [];
  for (let i = 0; i < total; i++) {
    job.done = i + 1;
    if (onProgress) onProgress(job);
    raw.push({ fileIdx: i, rows: await readPage(i) });
  }

  // сортировка по печатному номеру листа
  const sorted = sortPagesByNumber(raw);
  job.pagesSorted = sorted.map(s => (s.pno ? s.pno.n : null));

  const orderedTexts = sorted.map(s => s.rows.join('\n'));

  // спецификация — по всем страницам
  const items = parseSpecification(orderedTexts);

  // реквизиты
  const header = parseHeader(orderedTexts);
  // Сумма контракта = сумма всех позиций спецификации (надёжно: каждая позиция проверена qty×price≈sum).
  // Это корректнее, чем цифра из шапки (OCR её часто читает с ошибками).
  const totalSum = items.reduce((s, it) => s + (Number(it.sum) || 0), 0);
  header.total = totalSum ? String(Math.round(totalSum * 100) / 100) : (header.total || '');

  job.items = items;
  job.header = header;
  job.status = 'done';
  if (onProgress) onProgress(job);
  return job;
}
