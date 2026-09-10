// Парсер реквизитов контракта из OCR-текстов страниц
// Устойчив к типовым опечаткам OCR («Поставшик» вместо «Поставщик»).
// Стороны ищем в разделе «Юридические адреса» (раздел 13), иначе в преамбуле.
// Возвращает { num, date, customer, customer_inn, supplier, supplier_inn, ikz, total, vat_rate, status }

const MONTHS = { января: 1, февраля: 2, марта: 3, апреля: 4, мая: 5, июня: 6, июля: 7, августа: 8, сентября: 9, октября: 10, ноября: 11, декабря: 12 };

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function norm(s) {
  return clean(s).toLowerCase().replace(/ё/g, 'е');
}

// Короткое имя организации из строки: ООО «КОНС» / МБОУ «Бошняковская ООШ» / ИП Слин В.А.
const ORG_FORMS = '(?:МБОУ|МАОУ|МКОУ|ГБОУ|ГБУЗ|ООО|АО|ЗАО|ИП|МКУ|МУП|ГУП|ФГБОУ|СПК|КФХ|НКО|ФКУ|ГБУ)';
function shortOrgName(text) {
  if (!text) return '';
  const t = clean(text);
  // «МБОУ „Бошняковская ООШ"» внутри длинного названия — берём аббревиатуру в кавычках
  let m = t.match(new RegExp('(^|\\s)(' + ORG_FORMS + ')\\s*[«"]([^«»"]{2,120})', 'i'));
  if (m) {
    let nm = clean(m[3]);
    // если внутри имени есть закрывающая — берём до неё
    nm = nm.split(/[»"]/)[0];
    return `${m[2]} «${nm.trim()}»`;
  }
  // «… (МБОУ «Бошняковская ООШ»)» — внутри скобок
  m = t.match(/\(([^()]{2,150})\)/);
  if (m) {
    const inner = shortOrgName(m[1]);
    if (inner) return inner;
  }
  // ООО «КОНС» без кавычек в конце строки
  m = t.match(new RegExp('(^|\\s)(' + ORG_FORMS + ')\\s*[«"]?([^«»"\\n,]{2,120})', 'i'));
  if (m) return clean(`${m[2]} ${m[3]}`).replace(/[«»"]+$/, '');
  return '';
}

// Найти стороны: ищем раздел 13 (юридические адреса/реквизиты), и в нём блоки «Поставщик»/«Заказчик»
function parseParties(full) {
  let text = full;
  // обрежем до раздела с реквизитами, если он есть
  const idx13 = norm(full).search(/13\s*[.)]\s*юридические|юридические адреса|банковские реквизиты|реквизиты и подписи/i);
  if (idx13 >= 0) text = full.slice(idx13);

  const get = (wordBase) => {
    const re = new RegExp(`«?(?:${wordBase}|${typo(wordBase)})»?\\s*[:.]?\\s*([^\\n]{2,200})`, 'gi');
    const variants = [];
    let m;
    while ((m = re.exec(text)) !== null) variants.push(m[1]);
    for (const v of variants) {
      // отбрасываем, если это «именуемое в дальнейшем» (преамбула)
      if (/именуем|в дальнейшем|в лице|действующ|адрес|р\/сч|счет/i.test(v)) continue;
      // отрезаем хвост строки (адрес, банк) на типичных маркерах
      const cut = v.split(/\s*(?:юридический адрес|адрес:|банк|р\/сч|к\/сч|телефон|тел\.|e-?mail|с-?тай)\s*/i)[0];
      const org = shortOrgName(cut);
      if (org) return org;
    }
    return '';
  };

  return { supplier: get('Поставщик'), customer: get('Заказчик') };
}

function typo(w) {
  // OCR-опечатки: Поставщик -> Поставшик/Поставшик/Поставщик
  const map = { 'Поставщик': 'Поставщик|Поставшик|Поставшик' };
  return map[w] || w;
}

// ИНН стороны: ищем в блоке после имени стороны в разделе реквизитов
function parseInn(full, wordBase) {
  const idx13 = norm(full).search(/13\s*[.)]\s*юридические|юридические адреса|банковские реквизиты|реквизиты и подписи/i);
  const text = idx13 >= 0 ? full.slice(idx13) : full;
  const re = new RegExp(`«?(?:${wordBase}|${typo(wordBase)})»?[\\s\\S]{0,400}?ИНН\\s*(\\d{10,12})`, 'i');
  const m = text.match(re);
  return m ? m[1] : '';
}

function parseHeader(pageTexts) {
  const full = clean(pageTexts.join('\n'));
  const low = norm(full);
  const res = { num: '', date: '', customer: '', customer_inn: '', supplier: '', supplier_inn: '', ikz: '', total: '', vat_rate: '', status: 'active' };

  // ---------- номер контракта ----------
  let m = low.match(/(?:контракт\s*№|№\s*контракта)\s*([a-zа-яё0-9_\-]{1,50})/i);
  if (m) res.num = m[1].replace(/[«»"№]/g, '');
  if (!res.num || res.num.length <= 3) {
    m = full.match(/\b(?:CCI|ЗК|К|ИКЗ)\s*[:№]?\s*([A-Za-zА-Яа-яЁё0-9_\-]{6,})\b/);
    if (m) res.num = m[1];
  }

  // ---------- дата ----------
  m = full.match(/[«"]?\s*(\d{1,2})\s*[»"]?\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})/i);
  if (m && MONTHS[m[2].toLowerCase()]) {
    res.date = `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
  } else {
    m = full.match(/\b(\d{2})[./](\d{2})[./](\d{4})\b/);
    if (m) res.date = `${m[3]}-${m[2]}-${m[1]}`;
  }

  // ---------- ИКЗ ----------
  m = full.match(/ИКЗ\s*[:№]?\s*([0-9]{3}[0-9A-Za-zА-Яа-яЁё]{26,})/i);
  if (m) res.ikz = m[1];

  // ---------- стороны (раздел реквизитов/преамбула) ----------
  const parties = parseParties(full);
  res.supplier = parties.supplier;
  res.customer = parties.customer;
  // fallback: преамбула «Муниципальное … учреждение «Бошняковская ООШ» (МБОУ «…»)… «Заказчик»»
  if (!res.customer) {
    const pm = full.match(/учреждение\s*[«"]?([^«»"]{3,120})/i);
    if (pm) res.customer = clean(pm[1]);
  }

  // ---------- ИНН ----------
  res.customer_inn = parseInn(full, 'Заказчик');
  res.supplier_inn = parseInn(full, 'Поставщик');

  // ---------- сумма ----------
  m = full.match(/(?:цена контракта|итого|общая сумма|сумма контракта|всего)\s*[:—]?\s*([\d\s\u00A0]+[.,]\d{2})/i);
  if (m) res.total = clean(m[1]).replace(/\s/g, '').replace(',', '.');

  // ---------- НДС ----------
  if (/без\s+ндс|ндс\s+не\s+облагается|ндс\s*[:—]?\s*-\s*$/i.test(low)) {
    res.vat_rate = '';
  } else {
    m = full.match(/НДС\s*[—:]?\s*(\d{1,2})\s*%/i) || full.match(/(?:включая|с учётом)?\s*НДС\s*(\d{1,2})\s*%/i);
    if (m) res.vat_rate = m[1];
  }

  return res;
}

module.exports = { parseHeader };
