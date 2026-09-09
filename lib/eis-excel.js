// Генерация файла для ЕИС: копия шаблона «Объекты закупки» + строки позиций
const XLSX = require('xlsx');
const path = require('path');
const { unitCode } = require('./okei');

const TPL = path.join(__dirname, '..', 'data', 'eis-template.xls');

// Индексы колонок шаблона (0-based)
const C_NAME = 0;       // A — наименование объекта закупки
const PCH = 41;         // пользовательские характеристики: блок из 6 колонок каждый
const COKPD2 = 60;      // код позиции (ОКПД2/КТРУ)
const CTYPE = 61;       // тип объекта закупки (1 товар / 2 работа / 3 услуга)
const COKEI = 62;       // единица измерения (код ОКЕИ)
const CQTY = 63;        // количество
const CPRICE = 64;      // цена за единицу
const CVAT = 65;        // ставка НДС
const CCOUNTRY = 66;    // страна происхождения (ОКСМ)

// ВАЖНО: порядок блоков пользовательских характеристик в шаблоне:
//   блок 1: колонки 41..46 (наименование, тип, код ОКЕИ, знач.кач., знач.кол., диапазон)
//   блок 2: колонки 47..52
//   блок 3: колонки 53..58
const PCH_BLOCK = [
  { name: 'Стандарт (ГОСТ/ТР ТС)', kind: 'qual', gost: true },
  { name: 'Характеристики товара', kind: 'qual' },
  { name: '', kind: 'qual' },  // резерв
];

/**
 * Заполняет шаблон ЕИС данными позиций контракта.
 * @param {{items: Array<{name, unit, qty, price, okpd2, gost, chars}>}} data
 * @param {object} opts - { vat: 10|20|'Без НДС' , country: 643, type: '1' }
 * @returns {Buffer} буфер .xls файла
 */
function buildEisExcel(data, opts = {}) {
  const vat = opts.vat !== undefined ? opts.vat : 10;
  const country = opts.country !== undefined ? opts.country : 643;
  const type = opts.type || '1';

  const wb = XLSX.readFile(TPL);
  const ws = wb.Sheets['Спецификация'];

  // данные начинаются с 7-й строки (строки 1..6 — шапка)
  const startIdx = 6; // 0-based строка 6 => Excel row 7

  const setCell = (r, c, v) => {
    const addr = XLSX.utils.encode_cell({ r, c });
    const cell = ws[addr] || (ws[addr] = { t: 's' });
    cell.t = typeof v === 'number' ? 'n' : 's';
    cell.v = v;
  };

  data.items.forEach((it, i) => {
    const r = startIdx + i;
    setCell(r, C_NAME, it.name || '');
    // ГОСТ — в пользовательскую характеристику 1, доп. характеристики — во 2
    if (it.gost) {
      setCell(r, PCH + 0, 'Стандарт (ГОСТ/ТР ТС)');
      setCell(r, PCH + 1, '2');                 // тип: качественная
      setCell(r, PCH + 3, it.gost);
    }
    if (it.chars && it.chars.trim()) {
      setCell(r, PCH + 6, 'Характеристики товара');
      setCell(r, PCH + 7, '2');
      setCell(r, PCH + 9, it.chars);
    }
    setCell(r, COKPD2, it.okpd2 || '');
    setCell(r, CTYPE, type);
    setCell(r, COKEI, unitCode(it.unit) || '');
    setCell(r, CQTY, it.qty);
    setCell(r, CPRICE, it.price);
    setCell(r, CVAT, vat === null || vat === '' || vat === 'Без НДС' ? '' : vat);
    setCell(r, CCOUNTRY, country);
  });

  const lastRow = startIdx + data.items.length - 1;
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: 90 } });

  return XLSX.write(wb, { type: 'buffer', bookType: 'xls', bookSST: true });
}

module.exports = { buildEisExcel, TPL };
