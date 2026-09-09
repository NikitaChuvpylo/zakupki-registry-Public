 // Улучшенный парсер спецификации из OCR.
// Не требует внешнего AI/API.
// Пытается восстановить строки даже при ошибках OCR.

const STD_RE = /(ГОСТ|ТОСТ|ТУ|ТР\s*ТС|[ГТ]ОСТ\s*[РA-Z]?\s*\d)/i;

function clean(s) {
  return String(s || '')
    .replace(/[|_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// OCR часто путает:
function normalizeOcrNumbers(s) {
  return String(s || '')
    .replace(/[Оо]/g, '0')
    .replace(/[Зз]/g, '3')
    .replace(/[Бб]/g, '6')
    .replace(/[IІl]/g, '1')
    .replace(/[—–−]/g, '-');
}

const DEC =
  /\d{1,3}(?:[ \u00A0]?\d{3})*(?:[.,]\d{1,4})|\d+(?:[.,]\d{1,4})/g;

function num(s) {
  return parseFloat(
    String(s)
      .replace(/[ \u00A0]/g, '')
      .replace(',', '.')
  );
}

function findDecimals(line) {
  const out = [];
  let m;

  const source = normalizeOcrNumbers(line);
  const re = new RegExp(DEC.source, 'g');

  while ((m = re.exec(source)) !== null) {
    const v = num(m[0]);

    if (Number.isFinite(v) && v > 0 && v < 1e9) {
      out.push({
        raw: m[0],
        v,
        idx: m.index,
      });
    }
  }

  return out;
}

function isTriple(q, p, s) {
  if (!(q > 0)  !(p > 0)  !(s > 0)) return false;

  const prod = q * p;

  return Math.abs(prod - s) <= Math.max(2, prod * 0.05);
}

function isReasonableNumbers(q, p, s) {
  if (!(q > 0)  !(p > 0)  !(s > 0)) return false;

  // Слишком большие значения обычно относятся к реквизитам,
  // телефонам, ИНН и т.п.
  if (q > 10000000  p > 100000000  s > 1000000000) {
    return false;
  }

  return true;
}

function extractStandard(text) {
  const m = String(text || '').match(
    /(?:ГОСТ|ТОСТ)\s*[РA-Z]?\s*\d+(?:[.-]\d+){0,3}|ТУ\s*\d+(?:[.-]\d+){0,4}|ТР\s*ТС\s*\d{3}\s*[\/\\]\s*\d{4}/i
  );

  return m ? clean(m[0]) : '';
}

function extractOkpd2(text) {
  const source = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/ОКПД\s*2/gi, 'ОКПД2');

  // Основной вариант
  let m = source.match(
    /(?:ОКПД2?|ОКПД)\s*:?\s*(\d{2}\.\d{2}\.\d{2}\.\d{3})/i
  );

  if (m) return m[1];

  // Иногда OCR теряет подпись ОКПД2.
  m = source.match(/\b(\d{2}\.\d{2}\.\d{2}\.\d{3})\b/);

  return m ? m[1] : '';
}

// Ищем нормальную тройку чисел.
function findTriple(decs) {
  // Сначала строгий вариант:
  for (let i = 0; i + 2 < decs.length; i++) {
    const q = decs[i].v;
    const p = decs[i + 1].v;
    const s = decs[i + 2].v;

    if (isTriple(q, p, s)) {
      return {
        q,
        p,
        s,
        sumIdx: decs[i + 2].idx,
        startIdx: decs[i].idx,
        confidence: 1,
      };
    }
  }

  // Более мягкий вариант.
  // Если OCR ошибся в сумме, всё равно пытаемся принять строку.
  for (let i = 0; i + 2 < decs.length; i++) {
    const q = decs[i].v;
    const p = decs[i + 1].v;
    const s = decs[i + 2].v;

    if (!isReasonableNumbers(q, p, s)) continue;

    const expected = q * p;

    if (expected <= 0) continue;

    const error = Math.abs(expected - s) / expected;

    if (error <= 0.15) {
      return {
        q,
        p,
        s,
        sumIdx: decs[i + 2].idx,
        startIdx: decs[i].idx,
        confidence: 0.75,
      };
    }
  }

  return null;
}

// Иногда OCR переносит цену/сумму на следующую строку.
// Поэтому ищем числа в небольшом блоке строк.
function findBlockTriple(blockLines) {
  const text = blockLines.join(' ');
  const decs = findDecimals(text);

  if (decs.length < 3) return null;

  const triple = findTriple(decs);

  if (!triple) return null;

  return {
    ...triple,
    text,
  };
}

// Номер позиции:
// 1
// 1.
// 1)
// 1 |
// 001
function leadingNumber(line) {
  const m = String(line).match(
    /^\s*(\d{1,4})\s*(?:[.)|:;-]|\s)/
  );

  return m ? parseInt(m[1], 10) : null;
}

function guessUnit(line) {
  const source = String(line || '').toLowerCase();

  const units = [
    ['шт', /\bшт\.?\b/i],
    ['кг', /\bкг\.?\b/i],
    ['г', /\bг\.?\b/i],
    ['т', /\bт\.?\b/i],
    ['л', /\bл\.?\b/i],
    ['мл', /\bмл\.?\b/i],
    ['м', /\bм\.?\b/i],
    ['м2', /\bм2\b/i],
    ['м3', /\bм3\b/i],
    ['упак', /упак/i],
    ['уп', /\bуп\.?\b/i],
    ['пач', /пач/i],
    ['банк', /банк/i],
    ['бут', /бутыл/i],
    ['компл', /компл/i],
    ['рул', /рулон|рул/i],
  ];

  for (const [name, re] of units) {
    if (re.test(source)) return name;
  }

  return '';
}

function looksLikeHeader(line) {
  return /наименование|количество|цена|стоимость|сумма|единиц|ед\.?\s*изм/i.test(
    String(line || '')
  );
}

function looksLikeGarbage(line) {
  const s = clean(line);

  if (!s) return true;

  if (s.length < 3) return true;

  if (/^(страница|лист)\s*\d+/i.test(s)) return true;

  if (/рублей|тысяч рублей|млн\.|миллион/i.test(s)) return true;

  if (looksLikeHeader(s)) return true;

  return false;
}

function makeName(text, firstNumberIndex) {
  let name =
    firstNumberIndex >= 0
      ? text.slice(0, firstNumberIndex)
      : text;

  const stdIdx = name.search(STD_RE);

  if (stdIdx >= 0) {
    name = name.slice(0, stdIdx);
  }

  name = clean(name)
    .replace(/^[\s.\-–—:;,|]+/, '')
    .replace(/^\d{1,4}\s*[.)|\s:;-]+/, '')
    .replace(/^[-,–—:;\s]+/, '')
    .trim();

  return name;
}

function parseSpecification(pageTexts) {
  const lines = [];

  pageTexts.forEach((t, pi) => {
    String(t || '')
      .split('\n')
      .forEach((line, index) => {
        lines.push({
          line,
          pi,
          lineIndex: index,
        });
      });
  });

  const parsed = [];

  // Сначала пытаемся найти обычные строки.
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];

    if (looksLikeGarbage(current.line)) continue;

    const currentDecs = findDecimals(current.line);

    let triple = currentDecs.length >= 3
      ? findTriple(currentDecs)
      : null;

    let usedLines = [current.line];

    // Если в одной строке не нашли —
    // объединяем текущую + следующую.
    if (!triple && i + 1 < lines.length) {
      const next = lines[i + 1];

      if (
        next.pi === current.pi &&
        !looksLikeHeader(next.line)
      ) {
        const combined = ${current.line} ${next.line};
        const decs = findDecimals(combined);

        if (decs.length >= 3) {
          triple = findTriple(decs);

          if (triple) {
            usedLines = [current.line, next.line];
          }
        }
      }
    }

    // Ещё один вариант OCR:
    // название отдельно, цифры ещё через одну строку.
    if (!triple && i + 2 < lines.length) {
      const next1 = lines[i + 1];
      const next2 = lines[i + 2];

      if (
        next1.pi === current.pi &&
        next2.pi === current.pi
      ) {
        const combined =
          ${current.line} ${next1.line} ${next2.line};

        const decs = findDecimals(combined);

        if (decs.length >= 3) {
          triple = findTriple(decs);

          if (triple) {
            usedLines = [
              current.line,
              next1.line,
              next2.line,
            ];
          }
        }
      }
    }

    if (!triple) continue;

    const combinedText = usedLines.join(' ');

    const firstDec = findDecimals(combinedText)[0];

    const name = makeName(
      combinedText,
      firstDec ? firstDec.idx : -1
    );

    // Собираем контекст вокруг позиции.
    const contextStart = Math.max(0, i - 2);

    const contextEnd = Math.min(
      lines.length,
      i + 8
    );

    const context = lines
      .slice(contextStart, contextEnd)
      .map(x => x.line)
      .join(' ');

    const block = clean(
      ${context} ${combinedText}
    );

    const gost =
      extractStandard(block) ||
      extractStandard(combinedText);

    const okpd2 =
      extractOkpd2(block) ||
      extractOkpd2(combinedText);

    const itemNum =
      leadingNumber(current.line) ??
      leadingNumber(combinedText);

    const unit =
      guessUnit(combinedText) ||
      guessUnit(context);

    const roundedSum =
      Math.round(triple.s * 100) / 100;

    const roundedPrice =
      Math.round(triple.p * 100) / 100;

    const roundedQty =
      Math.round(triple.q * 1000000) / 1000000;

    // Если сумма OCR распознана криво,
    // но количество и цена очевидны,
    // используем рассчитанную сумму.
 let finalSum = roundedSum;

    const calculated =
      Math.round(roundedQty * roundedPrice * 100) / 100;

    const sumError =
      calculated > 0
        ? Math.abs(finalSum - calculated) / calculated
        : 1;

    if (sumError > 0.15) {
      finalSum = roundedSum;
    }

    parsed.push({
      pi: current.pi,
      orderIdx: i,
      num: itemNum,

      name:
        name ||
        '(не распознано — проверьте по странице)',

      unit,

      qty: roundedQty,
      price: roundedPrice,
      sum: finalSum,

      okpd2,
      gost,

      confidence:
        triple.confidence ?? 0.5,

      raw: combinedText
        .trim()
        .slice(0, 500),
    });
  }

  // Убираем дубли.
  const uniq = [];
  const seen = new Set();

  for (const item of parsed) {
    const key = [
      item.pi,
      item.qty,
      item.price,
      item.sum,
      clean(item.name).toLowerCase(),
    ].join('|');

    if (seen.has(key)) continue;

    seen.add(key);
    uniq.push(item);
  }

  // Сортировка по физическому расположению.
  uniq.sort(
    (a, b) =>
      (a.pi - b.pi) ||
      (a.orderIdx - b.orderIdx)
  );

  // Нумерация.
  let expected = 1;

  for (const item of uniq) {
    if (
      item.num !== null &&
      item.num > 0 &&
      item.num >= expected
    ) {
      expected = item.num + 1;
    } else {
      item.num = expected;
      expected++;
    }
  }

  return uniq;
}

module.exports = {
  parseSpecification,
  extractStandard,
  extractOkpd2,
};
