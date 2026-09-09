// Сервер «Реестр малых закупок»: Express + SQLite
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { db, DATA_DIR } = require('./lib/db');
const { buildEisExcel } = require('./lib/eis-excel');

const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const CONTRACTS_DIR = path.join(DATA_DIR, 'contracts');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(CONTRACTS_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- multer: приём PDF ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname || '.pdf')),
});
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.pdf$/i.test(file.originalname) || file.mimetype === 'application/pdf';
    cb(ok ? null : new Error('Только PDF'), ok);
  },
});

// --- helpers ---
function getContract(id) {
  return db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
}
function getItems(contractId) {
  return db.prepare('SELECT * FROM items WHERE contract_id = ? ORDER BY num').all(contractId);
}
function replaceItems(contractId, items) {
  const del = db.prepare('DELETE FROM items WHERE contract_id = ?');
  const ins = db.prepare(`INSERT INTO items
    (contract_id, num, name, unit, qty, price, sum, okpd2, gost, chars)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN');
  try {
    del.run(contractId);
    items.forEach((it, i) => {
      const n = it.num || i + 1;
      ins.run(
        contractId, n, it.name ?? null, it.unit ?? null,
        it.qty !== undefined && it.qty !== '' ? Number(it.qty) : null,
        it.price !== undefined && it.price !== '' ? Number(it.price) : null,
        it.sum !== undefined && it.sum !== '' ? Number(it.sum) : null,
        it.okpd2 ?? null, it.gost ?? null, it.chars ?? null
      );
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// --- распознавание (фоновые задачи) ---
// recognize.mjs подключается динамически (ESM) в момент запуска задачи
let recognizeApi = null;
async function getRecognize() {
  if (!recognizeApi) recognizeApi = await import('./lib/recognize.mjs');
  return recognizeApi;
}

// --- API ---
// Загрузить PDF -> создать контракт, отрендерить страницы
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не получен' });
    const ins = db.prepare(
      'INSERT INTO contracts (num, source_pdf, created_at) VALUES (?, ?, datetime(\'now\'))'
    ).run(null, req.file.filename);
    const id = Number(ins.lastInsertRowid);
    const pdfPath = path.join(UPLOADS_DIR, req.file.filename);
    const pagesDir = path.join(CONTRACTS_DIR, String(id), 'pages');
    // рендер страниц (для OCR нужен scale 3.5)
    const { pdfToImages } = await import('./lib/pdf2img.mjs');
    let pages = [];
    try {
      pages = await pdfToImages(pdfPath, pagesDir, 3.5);
    } catch (e) {
      console.error('Render error for contract', id, e);
    }
    db.prepare('UPDATE contracts SET source_pdf = ? WHERE id = ?').run(req.file.filename, id);
    const c = getContract(id);
    res.json({ contract: { ...c, pages, pagesDir } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Список контрактов
app.get('/api/contracts', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, COUNT(i.id) AS items_count
    FROM contracts c LEFT JOIN items i ON i.contract_id = c.id
    GROUP BY c.id ORDER BY c.id DESC`).all();
  res.json(rows);
});

// Карточка контракта
app.get('/api/contracts/:id', (req, res) => {
  const c = getContract(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Не найден' });
  const items = getItems(c.id);
  const pagesDir = path.join(CONTRACTS_DIR, String(c.id), 'pages');
  const pages = fs.existsSync(pagesDir)
    ? fs.readdirSync(pagesDir).filter(f => f.endsWith('.png')).sort().map(f => `/files/${c.id}/pages/${f}`)
    : [];
  res.json({ contract: c, items, pages });
});

// Статус распознавания
app.get('/api/contracts/:id/recognize', async (req, res) => {
  const id = Number(req.params.id);
  const rec = await getRecognize();
  const job = rec.getJob(id);
  res.json(job || { status: 'idle', done: 0, total: 0 });
});

// Запустить распознавание спецификации
app.post('/api/contracts/:id/recognize', async (req, res) => {
  const id = Number(req.params.id);
  const c = getContract(id);
  if (!c) return res.status(404).json({ error: 'Не найден' });
  const rec = await getRecognize();
  const pagesDir = path.join(CONTRACTS_DIR, String(id), 'pages');
  const ocrCacheDir = path.join(CONTRACTS_DIR, String(id), 'ocr');
  res.json({ status: 'started' });
  // фоновая задача (не блокируем ответ)
  setImmediate(async () => {
    try {
      const job = await rec.recognizeContract(id, pagesDir, ocrCacheDir, null);
      if (job.status === 'done') {
        if (job.items && job.items.length) replaceItems(id, job.items);
        if (job.header) {
          const h = job.header;
          db.prepare(`UPDATE contracts SET
            num = COALESCE(NULLIF(?, ''), num),
            date = COALESCE(NULLIF(?, ''), date),
            customer = COALESCE(NULLIF(?, ''), customer),
            customer_inn = COALESCE(NULLIF(?, ''), customer_inn),
            supplier = COALESCE(NULLIF(?, ''), supplier),
            supplier_inn = COALESCE(NULLIF(?, ''), supplier_inn),
            ikz = COALESCE(NULLIF(?, ''), ikz),
            total = COALESCE(NULLIF(?, ''), total),
            vat_rate = COALESCE(NULLIF(?, ''), vat_rate),
            status = COALESCE(NULLIF(?, ''), status)
            WHERE id = ?`).run(
            h.num || null, h.date || null, h.customer || null, h.customer_inn || null,
            h.supplier || null, h.supplier_inn || null, h.ikz || null,
            h.total || null, h.vat_rate !== undefined && h.vat_rate !== null && h.vat_rate !== '' ? String(h.vat_rate) : null,
            h.status || null, id
          );
        }
      }
    } catch (e) {
      console.error('Recognize error', e);
    }
  });
});

// Обновить поля контракта
app.put('/api/contracts/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getContract(id)) return res.status(404).json({ error: 'Не найден' });
  const { num, date, customer, customer_inn, supplier, supplier_inn, ikz, total, vat_rate, status } = req.body || {};
  db.prepare(`UPDATE contracts SET
    num = ?, date = ?, customer = ?, customer_inn = ?, supplier = ?,
    supplier_inn = ?, ikz = ?, total = ?, vat_rate = ?, status = ?
    WHERE id = ?`).run(
    num ?? null, date ?? null, customer ?? null, customer_inn ?? null,
    supplier ?? null, supplier_inn ?? null, ikz ?? null,
    total !== undefined && total !== '' ? Number(total) : null,
    vat_rate ?? null, status ?? 'active', id
  );
  res.json(getContract(id));
});

// Заменить все позиции спецификации
app.put('/api/contracts/:id/items', (req, res) => {
  const id = Number(req.params.id);
  if (!getContract(id)) return res.status(404).json({ error: 'Не найден' });
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  try {
    replaceItems(id, items);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  res.json(getItems(id));
});

// Скачать Excel для ЕИС
app.get('/api/contracts/:id/eis.xls', (req, res) => {
  const id = Number(req.params.id);
  const c = getContract(id);
  if (!c) return res.status(404).json({ error: 'Не найден' });
  const items = getItems(id);
  if (!items.length) return res.status(400).json({ error: 'Нет позиций спецификации' });
  try {
    const buf = buildEisExcel({ items }, { vat: c.vat_rate !== null && c.vat_rate !== '' ? Number(c.vat_rate) : 10 });
    const safeName = (c.num ? String(c.num).replace(/[^\wА-Яа-яЁё№\-\s]+/g, '_').trim() : `contract_${id}`) || `contract_${id}`;
    const fileName = `${safeName}_ЕИС.xls`;
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', `attachment; filename="contract_${id}.xls"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Удалить контракт
app.delete('/api/contracts/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!getContract(id)) return res.status(404).json({ error: 'Не найден' });
  db.prepare('DELETE FROM items WHERE contract_id = ?').run(id);
  db.prepare('DELETE FROM contracts WHERE id = ?').run(id);
  fs.rmSync(path.join(CONTRACTS_DIR, String(id)), { recursive: true, force: true });
  res.json({ ok: true });
});

// Статика для страниц PDF
app.use('/files/:contractId/pages', express.static(path.join(CONTRACTS_DIR, ':contractId', 'pages'), { fallthrough: true }));
app.get('/files/:contractId/pages/:name', (req, res) => {
  const p = path.join(CONTRACTS_DIR, req.params.contractId, 'pages', path.basename(req.params.name));
  if (fs.existsSync(p)) res.sendFile(p); else res.status(404).end();
});
// Исходный PDF
app.get('/files/:contractId/pdf', (req, res) => {
  const c = getContract(Number(req.params.contractId));
  if (!c || !c.source_pdf) return res.status(404).end();
  const p = path.join(UPLOADS_DIR, c.source_pdf);
  if (fs.existsSync(p)) res.sendFile(p); else res.status(404).end();
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Реестр малых закупок: http://localhost:${PORT}`);});
