import fs from 'node:fs';
import path from 'node:path';
import { createWorker } from 'tesseract.js';

import { parseSpecification } from './parse-spec.js';
import { parseHeader } from './parse-header.js';

const TESS = path.resolve('./data/tessdata');

const jobs = new Map();
let workerPromise = null;

console.log('🔥🔥🔥 RECOGNIZE.MJS — НОВАЯ ВЕРСИЯ ЗАГРУЖЕНА 🔥🔥🔥');

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      console.log('🚀 Запускаю Tesseract...');

      const worker = await createWorker(
        'rus',
        1,
        {
          langPath: TESS
        }
      );

      await worker.setParameters({
        preserve_interword_spaces: '1',
        user_defined_dpi: '300'
      });

      console.log('✅ Tesseract готов');

      return worker;
    })();
  }

  return workerPromise;
}

function buildRowsFromTsv(tsv) {
  const lines = String(tsv || '').split('\n');

  const words = [];

  for (const line of lines) {
    const parts = line.split('\t');

    if (parts.length < 12) continue;

    const text = String(parts[11] || '').trim();
    const conf = Number(parts[10]);

    if (!text) continue;
    if (!Number.isNaN(conf) && conf < 0) continue;

    const left = Number(parts[6]) || 0;
    const top = Number(parts[7]) || 0;
    const width = Number(parts[8]) || 0;
    const height = Number(parts[9]) || 0;

    if (width <= 0 || height <= 0) continue;

    words.push({
      text,
      left,
      top,
      width,
      height,
      cy: top + height / 2
    });
  }

  if (!words.length) {
    return [];
  }

  words.sort((a, b) => {
    if (Math.abs(a.cy - b.cy) > 12) {
      return a.cy - b.cy;
    }

    return a.left - b.left;
  });

  const rows = [];

  for (const word of words) {
    let row = null;

    for (let i = rows.length - 1; i >= 0; i--) {
      const candidate = rows[i];

      if (Math.abs(candidate.cy - word.cy) <= 12) {
        row = candidate;
        break;
      }

      if (candidate.cy < word.cy - 20) {
        break;
      }
    }

    if (!row) {
      row = {
        cy: word.cy,
        words: []
      };

      rows.push(row);
    }

    row.words.push(word);

    const sumY = row.words.reduce((sum, item) => sum + item.cy, 0);
    row.cy = sumY / row.words.length;
  }

  rows.sort((a, b) => a.cy - b.cy);

  return rows
    .map(row => {
      row.words.sort((a, b) => a.left - b.left);

      return row.words
        .map(word => word.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    })
    .filter(Boolean);
}

function scoreRows(rows) {
  if (!rows || !rows.length) {
    return -Infinity;
  }

  let score = 0;

  score += Math.min(rows.length, 50);

  for (const row of rows) {
    const s = String(row);

    const numbers = s.match(/\d+(?:[.,]\d+)?/g);

    if (numbers) {
      score += Math.min(numbers.length, 6) * 4;
    }

    if (
      /\d+[.,]\d{1,2}/.test(s) ||
      /\d+\s*[xх×]\s*\d+/.test(s)
    ) {
      score += 8;
    }

    if (/\d{2}\.\d{2}\.\d{2}/.test(s)) {
      score += 7;
    }

    if (
      /\bГОСТ\b/i.test(s) ||
      /\bТУ\b/i.test(s) ||
      /\bОКПД/i.test(s)
    ) {
      score += 4;
    }

    if (/^\s*\d{1,3}\s+[А-ЯA-ZЁ]/i.test(s)) {
      score += 3;
    }
  }

  return score;
}

async function recognizePage(worker, png, psm) {
  console.log(`🔎 OCR страницы: ${path.basename(png)}, PSM=${psm}`);

  await worker.setParameters({
    tessedit_pageseg_mode: String(psm),
    preserve_interword_spaces: '1',
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

  const text = result?.data?.text || '';
  const tsv = result?.data?.tsv || '';

  const rows = buildRowsFromTsv(tsv);

  return {
    rows,
    text,
    score: scoreRows(rows)
  };
}

function sortPagesByNumber(raw) {
  return [...raw].sort((a, b) => {
    const getNumber = item => {
      const text = item.rows.join('\n');

      const match =
        text.match(/(?:страница|стр\.?)\s*(\d+)/i) ||
        text.match(/^\s*(\d+)\s*$/m);


eturn match ? Number(match[1]) : null;
    };

    const aNum = getNumber(a);
    const bNum = getNumber(b);

    if (aNum === null && bNum === null) {
      return a.fileIdx - b.fileIdx;
    }

    if (aNum === null) return 1;
    if (bNum === null) return -1;

    return aNum - bNum;
  });
}

export async function recognizeContract(
  contractId,
  pagesDir,
  ocrCacheDir,
  onProgress
) {
  console.log('');
  console.log('==============================================');
  console.log('🔥 НОВАЯ ВЕРСИЯ recognizeContract ЗАПУЩЕНА 🔥');
  console.log(`📌 contractId: ${contractId}`);
  console.log(`📁 pagesDir: ${pagesDir}`);
  console.log(`📁 ocrCacheDir: ${ocrCacheDir}`);
  console.log('==============================================');
  console.log('');

  if (
    jobs.has(contractId) &&
    jobs.get(contractId).status === 'running'
  ) {
    console.log('⚠️ Для этого договора OCR уже запущен');

    return jobs.get(contractId);
  }

  const files = fs.existsSync(pagesDir)
    ? fs
        .readdirSync(pagesDir)
        .filter(f => /^page_\d+\.png$/i.test(f))
        .sort((a, b) => {
          const na = Number(a.match(/\d+/)?.[0] || 0);
          const nb = Number(b.match(/\d+/)?.[0] || 0);

          return na - nb;
        })
    : [];

  const total = files.length;

  console.log(`📄 Найдено PNG-страниц: ${total}`);

  if (!total) {
    const errorJob = {
      status: 'error',
      error: 'Нет страниц'
    };

    jobs.set(contractId, errorJob);

    console.error('❌ Нет PNG-страниц для распознавания');

    return errorJob;
  }

  const job = {
    status: 'running',
    done: 0,
    total,
    items: [],
    header: {},
    pagesSorted: []
  };

  jobs.set(contractId, job);

  fs.mkdirSync(ocrCacheDir, {
    recursive: true
  });

  const worker = await getWorker();

  const readPage = async i => {
    const png = path.join(
      pagesDir,
      files[i]
    );

    /*
     * ВАЖНО:
     * Старый OCR-кэш полностью отключён.
     *
     * Мы специально НЕ читаем .rows.v2,
     * чтобы Railway каждый раз реально
     * прогонял новую версию OCR.
     */

    console.log('');
    console.log('----------------------------------------------');
    console.log(`📄 СТРАНИЦА ${i + 1} / ${total}`);
    console.log(`🖼️ Файл: ${files[i]}`);
    console.log(`📏 Размер файла: ${fs.statSync(png).size} bytes`);
    console.log('----------------------------------------------');

    let pass6;

    try {
      pass6 = await recognizePage(
        worker,
        png,
        6
      );
    } catch (error) {
      console.error(
        `❌ Ошибка OCR PSM 6 на странице ${i + 1}:`,
        error
      );

      pass6 = {
        rows: [],
        text: '',
        score: -Infinity
      };
    }

    console.log(
      `PSM 6: строк=${pass6.rows.length}, score=${pass6.score}`
    );

    let best = pass6;

    let pass11;

    try {
      pass11 = await recognizePage(
        worker,
        png,
        11
      );
    } catch (error) {
      console.error(
        `❌ Ошибка OCR PSM 11 на странице ${i + 1}:`,
        error
      );

      pass11 = {
        rows: [],
        text: '',
        score: -Infinity
      };
    }

    console.log(
      `PSM 11: строк=${pass11.rows.length}, score=${pass11.score}`
    );

    if (pass11.score > best.score) {
      best = pass11;
    }

    if (best.score < 25) {
      let pass4;

      try {
        pass4 = await recognizePage(
          worker,
          png,
          4
        );
      } catch (error) {
        console.error(
          `❌ Ошибка OCR PSM 4 на странице ${i + 1}:`,
          error
        );

        pass4 = {
          rows: [],
          text: '',
          score: -Infinity
        };
      }

      console.log(
        `PSM 4: строк=${pass4.rows.length}, score=${pass4.score}`
      );

      if (pass4.score > best.score) {
        best = pass4;
      }
    }

    console.log('');
    console.log(`========== OCR PAGE ${i + 1} ==========`);

    console.log(
      `Строк распознано: ${best.rows.length}`
    );

    console.log(
      `Оценка OCR: ${best.score}`
    );


console.log('--- РАСПОЗНАННЫЕ СТРОКИ ---');

    best.rows
      .slice(0, 150)
      .forEach((row, index) => {
        console.log(
          `${index + 1}: ${row}`
        );
      });

    console.log('--- КОНЕЦ СТРОК ---');

    console.log(
      `Выбранный PSM: ${
        best === pass6
          ? 6
          : best === pass11
            ? 11
            : 4
      }`
    );

    console.log(
      `========== END OCR PAGE ${i + 1} ==========`
    );

    console.log('');

    /*
     * Записываем новый диагностический кэш
     * только после OCR.
     */
    const cache = path.join(
      ocrCacheDir,
      `page_${String(i + 1).padStart(3, '0')}.rows.debug`
    );

    try {
      fs.writeFileSync(
        cache,
        best.rows.join('\n'),
        'utf8'
      );
    } catch (error) {
      console.error(
        '⚠️ Не удалось записать OCR-кэш:',
        error
      );
    }

    return best.rows;
  };

  const raw = [];

  for (let i = 0; i < total; i++) {
    job.done = i + 1;

    if (onProgress) {
      onProgress(job);
    }

    try {
      const rows = await readPage(i);

      raw.push({
        fileIdx: i,
        rows
      });
    } catch (error) {
      console.error(
        `❌ Критическая ошибка страницы ${i + 1}:`,
        error
      );

      raw.push({
        fileIdx: i,
        rows: []
      });
    }
  }

  console.log('');
  console.log('==============================================');
  console.log('📊 OCR ВСЕХ СТРАНИЦ ЗАВЕРШЁН');
  console.log(`Страниц: ${raw.length}`);
  console.log(
    `Всего OCR-строк: ${raw.reduce(
      (sum, page) => sum + page.rows.length,
      0
    )}`
  );
  console.log('==============================================');
  console.log('');

  const sorted = sortPagesByNumber(raw);

  job.pagesSorted = sorted.map(
    s => (s.pno ? s.pno.n : null)
  );

  const orderedTexts = sorted.map(
    s => s.rows.join('\n')
  );

  console.log('🧾 Передаю OCR-текст в parseSpecification...');

  let items = [];

  try {
    items = parseSpecification(
      orderedTexts
    ) || [];
  } catch (error) {
    console.error(
      '❌ Ошибка parseSpecification:',
      error
    );

    items = [];
  }

  console.log(
    `📦 parseSpecification вернул позиций: ${items.length}`
  );

  console.log('');
  console.log('--- РЕЗУЛЬТАТ ПАРСЕРА ---');

  items.forEach((item, index) => {
    console.log(
      `${index + 1}:`,
      JSON.stringify(item)
    );
  });

  console.log('--- КОНЕЦ РЕЗУЛЬТАТА ПАРСЕРА ---');
  console.log('');

  let header = {};

  try {
    header =
      parseHeader(orderedTexts) || {};
  } catch (error) {
    console.error(
      '❌ Ошибка parseHeader:',
      error
    );

    header = {};
  }

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

  console.log('');
  console.log('==============================================');
  console.log('✅ RECOGNIZE ЗАВЕРШЁН');
  console.log(`Позиций найдено: ${items.length}`);
  console.log(`Сумма: ${header.total || 'не определена'}`);
  console.log('==============================================');
  console.log('');

  if (onProgress) {
    onProgress(job);
  }

  return job;
}

export function getRecognitionJob(contractId) {
  return jobs.get(contractId);
} r




