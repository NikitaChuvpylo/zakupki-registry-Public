// Парсер спецификации из OCR-строк страниц.
// Строка-позиция: содержит 3 числа, где qty × price ≈ sum (обычно в конце строки).
// Номер позиции берём из начала строки, если есть; сортируем по нему.
// ГОСТ/ОКПД2/наименование ищем в самой строке и соседних (блок до следующей позиции).

const STD_RE = /(ГОСТ|ТОСТ|ТУ|ТР\s*ТС|[ГТ]ОСТ\s*[РA-Z]?\s*\d)/i;

function clean(s) {
  return String(s || '').replace(/[|_]/g, ' ').replace(/\s+/g, ' ').trim();
}

const DEC = /\d{1,3}(?:[ \u00A0]?\d{3})*(?:[.,]\d{1,2})|\d+(?:[.,]\d{1,2})/g;

function num(s) {
  return parseFloat(String(s).replace(/[ \u00A0]/g, '').replace(',', '.'));
}

function findDecimals(line) {
  const out = [];
  let m;
  const re = new RegExp(DEC.source, 'g');
  while ((m = re.exec(line)) !== null) {
    const v = num(m[0]);
    if (v > 0 && v < 1e9) out.push({ raw: m[0], v, idx: m.index });
  }
  return out;
}

function isTriple(q, p, s) {
  if (!(q > 0) || !(p > 0) || !(s > 0)) return false;
  const prod = q * p;
  return Math.abs(prod - s) <= Math.max(1, prod * 0.02);
}

function extractStandard(text) {
  const m = String(text || '').match(/(?:ГОСТ|ТОСТ)\s*[РA-Z]?\s*\d+(?:[.-]\d+){0,2}|ТУ\s*\d+(?:[.-]\d+){0,3}|ТР\s*ТС\s*\d{3}\s*[\/\\]\s*\d{4}/i);
  return m ? clean(m[0]) : '';
}

function extractOkpd2(text) {
  const m = String(text || '').match(/(?:ОКПД\s*2?|ОКПД2)\s*:?\s*\.?\s*(\d{2}\.\d{2}\.\d{2}\.\d{3})/i);
  return m ? m[1] : '';
}

// Найти тройку чисел (qty, price, sum) в строке: sum — последнее число.
function findTriple(decs) {
  for (let i = 0; i + 2 < decs.length; i++) {
    const q = decs[i].v, p = decs[i + 1].v, s = decs[i + 2].v;
    if (isTriple(q, p, s)) return { q, p, s, sumIdx: decs[i + 2].idx, startIdx: decs[i].idx };
  }
  return null;
}

// Номер позиции в начале строки: «1 |», «28.», «4)», «12 »
function leadingNumber(line) {
  const m = String(line).match(/^\s*(\d{1,3})\s*[.)|\s]/);
  return m ? parseInt(m[1], 10) : null;
}

function guessUnit(line) {
  const m = String(line).match(/(литр|кг|шт|упак|банк|бутыл|мл|пач|г\b)/i);
  return m ? m[1] : '';
}

/**
 * @param {string[]} pageTexts - тексты страниц (каждая = строки через \n)
 */
function parseSpecification(pageTexts) {
  const lines = [];
  pageTexts.forEach((t, pi) => {
    String(t || '').split('\n').forEach(line => lines.push({ line, pi }));
  });

  // 1) кандидаты: строки с тройкой (qty×price≈sum)
  const rows = [];
  lines.forEach(({ line, pi }, li) => {
    if (!line || line.trim().length < 4) return;
    if (/рублей|тысяч рублей|млн\.|миллион/i.test(line)) return;
    const decs = findDecimals(line);
    if (decs.length < 3) return;
    const triple = findTriple(decs);
    if (!triple) return;
    const afterSum = line.slice(triple.sumIdx + 1).trim();
    if (afterSum.length > 30) return;
    rows.push({ li, pi, ...triple, line });
  });

  // 2) блок для ГОСТ/ОКПД2 и сборка имени
  const parsed = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const nextLi = r + 1 < rows.length ? rows[r + 1].li : lines.length;
    let block = '';
    for (let li = Math.max(0, row.li - 1); li < Math.min(nextLi, row.li + 40); li++) block += ' ' + lines[li].line;
    block = clean(block);

    // имя: текст строки до начала чисел
    const firstDec = findDecimals(row.line)[0];
    let name = firstDec ? row.line.slice(0, firstDec.idx) : row.line;
    const stdIdx = name.search(STD_RE);
    if (stdIdx >= 0) name = name.slice(0, stdIdx);
    name = clean(name)
      .replace(/^[\s.\-–—:;,|]+/, '')
      .replace(/^\d{1,3}\s*[.)|\s]+/, '')
      .replace(/^[-,–—:;\s]+/, '')
      .trim();

    const gost = extractStandard(block) || extractStandard(row.line);
    const okpd2 = extractOkpd2(block) || extractOkpd2(row.line);
    const itemNum = leadingNumber(row.line);

    parsed.push({
      pi: row.pi,
      orderIdx: r,                 // физический порядок (для стабильности)
      num: itemNum,                // номер из PDF, если распознан
      name: name || '(не распознано — проверьте по странице)',
      unit: guessUnit(row.line),
      qty: row.q,
      price: row.p,
      sum: Math.round(row.s * 100) / 100,
      okpd2,
      gost,
      raw: row.line.trim().slice(0, 250),
    });
  }

  // 3) дедупликация дублей (одинаковые qty×price×sum рядом)
  const uniq = [];
  const seenKeys = new Set();
  for (const it of parsed) {
    const key = `${it.qty}|${it.price}|${it.sum}`;
    if (seenKeys.has(key) && it.name.length < 3) continue; // пустой дубль
    seenKeys.add(key);
    uniq.push(it);
  }

  // 4) сортировка по физическому порядку страниц (страницы уже отсортированы по листам),
  //    а внутри страницы — по порядку строк. Номер из PDF используем как «якорь»:
  //    если впереди идущая строка имела номер N, а текущая без номера — присваиваем N+1.
  uniq.sort((a, b) => (a.pi - b.pi) || (a.orderIdx - b.orderIdx));

  // интерполяция номеров: идём по порядку, ведём ожидаемый номер.
  // Если у строки есть свой номер и он ≥ ожидаемого — берём его и обновляем ожидание.
  // Если номера нет — берём ожидаемый.
  let expected = 1;
  for (const it of uniq) {
    if (it.num !== null && it.num > 0 && it.num >= expected) {
      expected = it.num + 1;
    } else {
      it.num = expected;
      expected++;
    }
  }
  return uniq;
}

module.exports = { parseSpecification, extractStandard, extractOkpd2 };
