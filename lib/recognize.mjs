// OCR-распознавание договора.
// Улучшенная версия:
// - два режима Tesseract для сложных сканов;
// - TSV с координатами слов;
// - восстановление визуальных строк;
// - защита от старого OCR-кэша;
// - автоматический выбор более удачного OCR-результата.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWorker } from 'tesseract.js';

import { parseSpecification } from './parse-spec.js';
import { parseHeader } from './parse-header.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESS = path.join(__dirname, '..', 'data', 'tessdata');

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('rus', 1, {
      langPath: TESS
    });
  }

  return workerPromise;
}

const jobs = new Map();

export function getJob(contractId) {
  return jobs.get(contractId) || null;
}

export function clearJob(contractId) {
  jobs.delete(contractId);
}


// ------------------------------------------------------------
// TSV -> визуальные строки
// ------------------------------------------------------------

function buildRowsFromTsv(tsv) {
  if (!tsv) return [];

  const lines = String(tsv)
    .trim()
    .split('\n');

  const words = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split('\t');

    if (parts.length < 12) continue;

    // TSV level 5 = слово
    if (parts[0].trim() !== '5') continue;

    const left = Number(parts[6]) || 0;
    const top = Number(parts[7]) || 0;
    const width = Number(parts[8]) || 0;
    const height = Number(parts[9]) || 1;

    const conf = Number(parts[10]);

    const text = (parts[11] || '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) continue;

    // Отбрасываем совсем мусорные OCR-слова,
    // но не удаляем числа — они особенно важны для таблицы.
    if (Number.isFinite(conf) && conf >= 0 && conf < 8 && text.length <= 2) {
      continue;
    }

    words.push({
      left,
      top,
      width,
      height,
      cy: top + height / 2,
      text
    });
  }

  if (!words.length) return [];

  // Медианная высота символов/слов.
  const heights = words
    .map(w => w.height)
    .filter(n => n > 0)
    .sort((a, b) => a - b);

  const medH =
    heights[Math.floor(heights.length / 2)] ||
    12;

  // Для сканов таблиц немного увеличиваем допуск.
  const threshold = Math.max(
    8,
    Math.min(22, medH * 0.75)
  );

  words.sort((a, b) => {
    if (Math.abs(a.cy - b.cy) < threshold) {
      return a.left - b.left;
    }

    return a.cy - b.cy;
  });

  const clusters = [];

  for (const word of words) {
    let target = null;

    // Ищем ближайшую существующую строку.
    let bestDistance = Infinity;

    for (const cluster of clusters) {
      const distance = Math.abs(word.cy - cluster.cy);

      if (distance <= threshold && distance < bestDistance) {
        bestDistance = distance;
        target = cluster;
      }
    }

    if (!target) {
      target = {
        cy: word.cy,
        words: []
      };

      clusters.push(target);
    }

    target.words.push(word);

    target.cy =
      target.words.reduce(
        (sum, w) => sum + w.cy,
        0
      ) / target.words.length;
  }

  return clusters
    .sort((a, b) => a.cy - b.cy)
    .map(cluster => {
      cluster.words.sort(
        (a, b) => a.left - b.left
      );

      return cluster.words
        .map(w => w.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    })
    .filter(Boolean);
}


// ------------------------------------------------------------
// Оценка качества OCR
// ------------------------------------------------------------

function scoreRows(rows) {
  if (!rows || !rows.length) return -Infinity;

  let score = 0;

  // Сам факт наличия строк.
  score += Math.min(rows.length, 50);

  for (const row of rows) {
    const s = String(row);

    // Числа очень важны для спецификации.
    const numbers = s.match(
      /\d+(?:[.,]\d+)?/g
    );

    if (numbers) {
      score += Math.min(numbers.length, 6) * 4;
    }
// Цена / сумма.
    if (
      /\d+[.,]\d{1,2}/.test(s) ||
      /\d+\s*[xх×]\s*\d+/.test(s)
    ) {
      score += 8;
    }

    // ОКПД2.
    if (/\d{2}\.\d{2}\.\d{2}/.test(s)) {
      score += 7;
    }

    // ГОСТ / ТУ / ОКПД.
    if (
      /\bГОСТ\b/i.test(s) ||
      /\bТУ\b/i.test(s) ||
      /\bОКПД/i.test(s)
    ) {
      score += 4;
    }

    // Номер позиции.
    if (/^\s*\d{1,3}\s+[А-ЯA-ZЁ]/i.test(s)) {
      score += 3;
    }
  }

  return score;
}


// ------------------------------------------------------------
// OCR одной страницы
// ------------------------------------------------------------

async function recognizePage(worker, png, psm) {
  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),

    // Сохраняем пробелы между колонками.
    preserve_interword_spaces: '1',

    // Помогаем Tesseract понимать размер исходника.
    user_defined_dpi: '300'
  });

  const result = await worker.recognize(
    png,
    {},
    {
      text: true,
      tsv: true
    }
  );

  const rows = buildRowsFromTsv(
    result?.data?.tsv || ''
  );

  return {
    rows,
    text: result?.data?.text || '',
    score: scoreRows(rows)
  };
}


// ------------------------------------------------------------
// Номер страницы
// ------------------------------------------------------------

function printedPageNoFromRows(rows) {
  if (!rows || !rows.length) return null;

  for (
    let i = 0;
    i < Math.min(5, rows.length);
    i++
  ) {
    const s = String(rows[i] || '')
      .replace(/[|\s\u00A0]+/g, '')
      .trim();

    const m2 = s.match(
      /(?:стр\.?|лист|страниц[аы]?)\s*[№:.\s]*(\d{1,3})/i
    );

    if (m2) {
      return {
        n: parseInt(m2[1], 10),
        strong: true
      };
    }

    const m = s.match(/^(\d{1,3})$/);

    if (m) {
      const n = parseInt(m[1], 10);

      if (n >= 5 && n <= 300) {
        return {
          n,
          strong: true
        };
      }
    }
  }

  return null;
}


// ------------------------------------------------------------
// Сортировка страниц
// ------------------------------------------------------------

function sortPagesByNumber(items) {
  const prepared = items.map((item, idx) => {
    const topText = item.rows
      .slice(0, 7)
      .join('\n');

    const isSpecHead =
      /^\s*СПЕЦИФИКАЦИЯ/i.test(topText) ||
      /^\s*Приложение\s*№\s*1/i.test(topText) ||
      /\bСПЕЦИФИКАЦИЯ\b/i.test(
        topText.slice(0, 300)
      );

    const pno = isSpecHead
      ? { n: 0, strong: true }
      : printedPageNoFromRows(item.rows);

    return {
      ...item,
      pno,
      isSpecHead,
      idx
    };
  });

  const numbered = prepared.filter(
    x => x.pno && x.pno.strong
  );

  const realNums = numbered.filter(
    x => x.pno.n > 0
  ).length;

  const hasHead = prepared.some(
    x => x.isSpecHead
  );

  if (
    hasHead ||
    realNums >= Math.max(
      2,
      Math.ceil(items.length * 0.4)
    )
  ) {
    return prepared
      .slice()
      .sort((a, b) => {
        const na = a.pno
          ? a.pno.n
          : 9999;

        const nb = b.pno
          ? b.pno.n
          : 9999;

        if (na !== nb) {
          return na - nb;
        }

        return a.idx - b.idx;
      });
  }

  return prepared;
}


// ------------------------------------------------------------
// Полное распознавание
// ------------------------------------------------------------

export async function recognizeContract(
  contractId,
  pagesDir,
  ocrCacheDir,
  onProgress
) {
  if (
    jobs.has(contractId) &&
    jobs.get(contractId).status === 'running'
  ) {
    return jobs.get(contractId);
  }

  const files = fs.existsSync(pagesDir)
    ? fs
        .readdirSync(pagesDir)
        .filter(f => /^page_\d+\.png$/.test(f))
        .sort()
    : [];

  const total = files.length;

  if (!total) {
    const errorJob = {
      status: 'error',
      error: 'Нет страниц'
    };

    jobs.set(contractId, errorJob);

    return errorJob;
  }

  const job = {
    status: 'running',
    done: 0,
    total,
    items: [],
[10.09.2026 4:15] Никита Андреевич: header: {},
    pagesSorted: []
  };

  jobs.set(contractId, job);

  fs.mkdirSync(
    ocrCacheDir,
    { recursive: true }
  );

  const worker = await getWorker();

  const readPage = async i => {
    const cache = path.join(
      ocrCacheDir,
      `page_${String(i + 1).padStart(3, '0')}.rows.v2`
    );

    // Новый .v2-кэш специально используется,
    // чтобы старый плохой OCR больше не мешал тестам.
    if (fs.existsSync(cache)) {
      return fs
        .readFileSync(cache, 'utf8')
        .split('\n')
        .filter(Boolean);
    }

    const png = path.join(
      pagesDir,
      files[i]
    );

    // Первый режим:
    // PSM 6 — хороший вариант для обычной таблицы.
    const pass6 = await recognizePage(
      worker,
      png,
      6
    );

    let best = pass6;

    // Второй режим:
    // PSM 11 — лучше вытаскивает разрозненный текст
    // на плохих/перекошенных сканах.
    //
    // Запускаем его всегда, потому что он может найти
    // числа и отдельные колонки, которые PSM 6 пропустил.
    const pass11 = await recognizePage(
      worker,
      png,
      11
    );

    if (pass11.score > best.score) {
      best = pass11;
    }

    // Если оба варианта слабые,
    // пробуем PSM 4 — колонночная структура.
    if (best.score < 25) {
      const pass4 = await recognizePage(
        worker,
        png,
        4
      );

      if (pass4.score > best.score) {
        best = pass4;
      }
    }

    fs.writeFileSync(
      cache,
      best.rows.join('\n'),
      'utf8'
    );

    return best.rows;
  };


  const raw = [];

  for (let i = 0; i < total; i++) {
    job.done = i + 1;

    if (onProgress) {
      onProgress(job);
    }

    const rows = await readPage(i);

    raw.push({
      fileIdx: i,
      rows
    });
  }


  // Сортируем страницы.
  const sorted = sortPagesByNumber(raw);

  job.pagesSorted = sorted.map(
    s => (s.pno ? s.pno.n : null)
  );

  const orderedTexts = sorted.map(
    s => s.rows.join('\n')
  );


  // Парсим спецификацию.
  const items = parseSpecification(
    orderedTexts
  );

  // Парсим реквизиты.
  const header = parseHeader(
    orderedTexts
  );


  // Общая сумма.
  const totalSum = items.reduce(
    (sum, item) =>
      sum + (Number(item.sum) || 0),
    0
  );

  header.total = totalSum
    ? String(
        Math.round(totalSum * 100) / 100
      )
    : (header.total || '');


  job.items = items;
  job.header = header;
  job.status = 'done';

  if (onProgress) {
    onProgress(job);
  }

  return job;
}
