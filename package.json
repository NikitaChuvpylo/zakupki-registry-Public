// Реестр малых закупок — клиент
let contracts = [];
let current = null;   // текущий контракт { contract, items, pages }
let dirty = false;

const $ = (id) => document.getElementById(id);

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    ...opts,
  });
  if (!res.ok) {
    const t = await res.json().catch(() => ({}));
    throw new Error(t.error || res.statusText);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res;
}

function setStatus(text, color) {
  const el = $('card-status');
  el.textContent = text || '';
  el.style.color = color || '#166534';
}

// ---------- Список ----------
async function loadList() {
  contracts = await api('/api/contracts');
  renderList();
}

function renderList() {
  const q = ($('search').value || '').toLowerCase().trim();
  const st = $('status-filter').value;
  const rows = contracts.filter(c => {
    const hay = [c.num, c.supplier, c.customer, c.supplier_inn, c.customer_inn, c.ikz].filter(Boolean).join(' ').toLowerCase();
    return (!q || hay.includes(q)) && (!st || c.status === st);
  });
  const tbody = document.querySelector('#contracts-table tbody');
  tbody.innerHTML = '';
  $('empty-hint').classList.toggle('hidden', contracts.length > 0);
  rows.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><a class="row-link" data-id="${c.id}" href="#">${esc(c.num || '(без номера)')}</a></td>
      <td>${esc(c.date || '')}</td>
      <td>${esc(c.supplier || '')}</td>
      <td>${fmtMoney(c.total)}</td>
      <td>${c.items_count ?? ''}</td>
      <td><span class="badge badge-${esc(c.status || 'active')}">${statusLabel(c.status)}</span></td>
      <td>
        <a href="#" data-id="${c.id}" class="row-link open-card">открыть</a>
      </td>`;
    tbody.appendChild(tr);
  });
}

function statusLabel(s) {
  return { active: 'Активен', done: 'Исполнен', terminated: 'Расторгнут' }[s] || s;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '';
  return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Навигация ----------
function showList() {
  $('list-view').classList.remove('hidden');
  $('card-view').classList.add('hidden');
  loadList();
}
async function openCard(id) {
  const data = await api(`/api/contracts/${id}`);
  current = data;
  dirty = false;
  $('list-view').classList.add('hidden');
  $('card-view').classList.remove('hidden');
  fillCard();
}

function fillCard() {
  if (!current) return;
  const c = current.contract;
  $('card-title').textContent = c.num ? `Контракт ${c.num}` : 'Контракт (без номера)';
  $('f-num').value = c.num || '';
  $('f-date').value = c.date || '';
  $('f-customer').value = c.customer || '';
  $('f-customer-inn').value = c.customer_inn || '';
  $('f-supplier').value = c.supplier || '';
  $('f-supplier-inn').value = c.supplier_inn || '';
  $('f-ikz').value = c.ikz || '';
  $('f-total').value = c.total ?? '';
  $('f-vat').value = c.vat_rate !== null && c.vat_rate !== undefined && c.vat_rate !== '' ? String(c.vat_rate) : '';
  $('f-status').value = c.status || 'active';
  setStatus('');

  // страницы PDF
  const wrap = $('pdf-pages');
  wrap.innerHTML = '';
  $('no-pages-hint').classList.toggle('hidden', current.pages.length > 0);
  current.pages.forEach((p, i) => {
    const img = document.createElement('img');
    img.src = p;
    img.alt = `Стр. ${i + 1}`;
    img.title = `Стр. ${i + 1} (клик — увеличить)`;
    img.addEventListener('click', () => img.classList.toggle('zoomed'));
    wrap.appendChild(img);
  });

  renderItems();
  bindFields();
}

// ---------- Поля ----------
function bindFields() {
  ['f-num', 'f-date', 'f-customer', 'f-customer-inn', 'f-supplier', 'f-supplier-inn', 'f-ikz', 'f-total', 'f-vat', 'f-status']
    .forEach(id => {
      $(id).addEventListener('input', () => { dirty = true; });
      $(id).addEventListener('change', () => { dirty = true; });
    });
}

function collectFields() {
  return {
    num: $('f-num').value || null,
    date: $('f-date').value || null,
    customer: $('f-customer').value || null,
    customer_inn: $('f-customer-inn').value || null,
    supplier: $('f-supplier').value || null,
    supplier_inn: $('f-supplier-inn').value || null,
    ikz: $('f-ikz').value || null,
    total: $('f-total').value !== '' ? Number($('f-total').value) : null,
    vat_rate: $('f-vat').value !== '' ? $('f-vat').value : null,
    status: $('f-status').value || 'active',
  };
}

// ---------- Позиции ----------
function renderItems() {
  const tbody = document.querySelector('#items-table tbody');
  tbody.innerHTML = '';
  const items = current.items;
  if (!items.length) return;
  items.forEach((it, i) => tbody.appendChild(itemRow(it, i)));
  updateSums();
}

function itemRow(it, idx) {
  const tr = document.createElement('tr');
  tr.dataset.idx = idx;
  tr.innerHTML = `
    <td class="num-col"><input data-f="num" type="text" value="${esc(it.num ?? idx + 1)}"></td>
    <td class="name-col"><input data-f="name" type="text" value="${esc(it.name ?? '')}"></td>
    <td><input data-f="okpd2" type="text" value="${esc(it.okpd2 ?? '')}" placeholder="ХХ.ХХ.ХХ.ХХХ"></td>
    <td><input data-f="unit" type="text" value="${esc(it.unit ?? '')}" placeholder="кг / шт / л"></td>
    <td><input data-f="qty" type="number" step="0.01" value="${it.qty ?? ''}"></td>
    <td><input data-f="price" type="number" step="0.01" value="${it.price ?? ''}"></td>
    <td><input data-f="sum" type="text" readonly class="auto"></td>
    <td><input data-f="gost" type="text" value="${esc(it.gost ?? '')}" placeholder="ГОСТ 31450-2013"></td>
    <td><input data-f="chars" type="text" value="${esc(it.chars ?? '')}" placeholder="доп. характеристики"></td>
    <td><button class="btn btn-ghost del-item" title="Удалить позицию">✕</button></td>`;
  tr.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      dirty = true;
      updateSums();
    });
  });
  tr.querySelector('.del-item').addEventListener('click', () => {
    current.items.splice(idx, 1);
    renderItems();
    dirty = true;
  });
  return tr;
}

function updateSums() {
  let totalQty = 0;
  let totalSum = 0;
  let hasQty = false;
  document.querySelectorAll('#items-table tbody tr').forEach(tr => {
    const get = (f) => tr.querySelector(`input[data-f="${f}"]`);
    const qty = parseFloat(get('qty').value);
    const price = parseFloat(get('price').value);
    const sumEl = get('sum');
    if (!isNaN(qty) && !isNaN(price)) {
      sumEl.value = (qty * price).toFixed(2);
      totalQty += qty;
      totalSum += qty * price;
      hasQty = true;
    } else sumEl.value = '';
  });
  // строка ИТОГО
  const tfoot = $('items-tfoot');
  const totalEl = $('items-total');
  const rows = document.querySelectorAll('#items-table tbody tr').length;
  if (hasQty) {
    tfoot.classList.remove('hidden');
    $('tfoot-qty').textContent = fmtMoney(totalQty);
    $('tfoot-sum').textContent = fmtMoney(totalSum);
    totalEl.classList.remove('hidden');
    totalEl.textContent = `Всего позиций: ${rows}, сумма: ${fmtMoney(totalSum)} ₽`;
  } else {
    tfoot.classList.add('hidden');
    totalEl.classList.add('hidden');
  }
}

function collectItems() {
  return Array.from(document.querySelectorAll('#items-table tbody tr')).map((tr, i) => {
    const get = (f) => tr.querySelector(`input[data-f="${f}"]`);
    return {
      num: parseInt(get('num').value) || i + 1,
      name: get('name').value,
      okpd2: get('okpd2').value,
      unit: get('unit').value,
      qty: get('qty').value,
      price: get('price').value,
      gost: get('gost').value,
      chars: get('chars').value,
    };
  });
}

// ---------- Распознавание спецификации ----------
let recognizeTimer = null;

function startRecognize(contractId, auto) {
  clearInterval(recognizeTimer);
  const btn = $('btn-recognize');
  btn.disabled = true;
  const msg = auto ? 'Распознаю спецификацию с последней страницы…' : 'Распознаю… (это может занять 1–3 минуты)';
  setStatus(msg, '#b45309');
  fetch(`/api/contracts/${contractId}/recognize`, { method: 'POST' }).catch(() => {});
  recognizeTimer = setInterval(async () => {
    try {
      const st = await api(`/api/contracts/${contractId}/recognize`);
      if (st.status === 'running') {
        setStatus(`Распознаю страницы: ${st.done}/${st.total || '?'}…`, '#b45309');
        return;
      }
      clearInterval(recognizeTimer);
      btn.disabled = false;
      if (st.status === 'done') {
        await openCard(contractId);
        if (current.items.length) {
          setStatus(`Готово: распознано ${current.items.length} позиций. Проверьте и исправьте — OCR сканов не идеален, затем «Скачать для ЕИС».`);
        } else {
          setStatus('Распознавание завершено, но позиции не найдены. Проверьте, что в PDF есть таблица спецификации, или заполните вручную.', '#b45309');
        }
      } else {
        setStatus('Распознавание прервано: ' + (st.error || 'ошибка'), '#b91c1c');
      }
    } catch (e) {
      clearInterval(recognizeTimer);
      btn.disabled = false;
      setStatus('Ошибка распознавания: ' + e.message, '#b91c1c');
    }
  }, 2500);
}

$('btn-recognize').addEventListener('click', () => {
  if (!current) return;
  if (!confirm('Запустить распознавание спецификации из PDF? Текущие позиции будут заменены результатом.')) return;
  startRecognize(current.contract.id, false);
});

// ---------- Действия ----------
$('btn-back').addEventListener('click', showList);
$('search').addEventListener('input', renderList);
$('status-filter').addEventListener('change', renderList);

document.querySelector('#contracts-table tbody').addEventListener('click', (e) => {
  const a = e.target.closest('.open-card');
  if (a) { e.preventDefault(); openCard(Number(a.dataset.id)); }
});

$('btn-fetch-mail').addEventListener('click', async () => {
  const status = $('upload-status');
  status.textContent = 'Проверяю почту…';
  status.style.color = '#b45309';
  try {
    const res = await fetch('/api/mail/fetch', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка');
    if (data.imported && data.imported.length) {
      status.textContent = `Новых контрактов: ${data.imported.length} (проверено писем: ${data.checked})`;
      status.style.color = '#166534';
    } else {
      status.textContent = `Новых контрактов нет (проверено писем: ${data.checked})`;
      status.style.color = '#374151';
    }
    if (data.errors && data.errors.length) {
      console.warn('Ошибки при разборе некоторых писем:', data.errors);
    }
    await loadList();
  } catch (err) {
    status.textContent = 'Ошибка почты: ' + err.message;
    status.style.color = '#b91c1c';
  }
});

$('pdf-upload').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const status = $('upload-status');
  const isPhotos = files.length > 1 || !/\.pdf$/i.test(files[0].name);
  status.textContent = isPhotos
    ? `Загружаю ${files.length} фото и распознаю…`
    : 'Загружаю и распознаю страницы…';
  status.style.color = '#b45309';
  try {
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error((await res.json()).error || 'Ошибка');
    const data = await res.json();
    status.textContent = 'Готово';
    status.style.color = '#166534';
    e.target.value = '';
    await loadList();
    await openCard(data.contract.id);
    const title = files[0].name.replace(/\.(pdf|jpe?g|png|webp)$/i, '');
    $('card-title').textContent = title;
    $('f-num').value = title;
    // автоматически распознать спецификацию
    startRecognize(data.contract.id, true);
  } catch (err) {
    status.textContent = 'Ошибка: ' + err.message;
    status.style.color = '#b91c1c';
  }
});

$('btn-save').addEventListener('click', async () => {
  if (!current) return;
  setStatus('Сохраняю…', '#b45309');
  try {
    await api(`/api/contracts/${current.contract.id}`, { method: 'PUT', body: JSON.stringify(collectFields()) });
    await api(`/api/contracts/${current.contract.id}/items`, { method: 'PUT', body: JSON.stringify({ items: collectItems() }) });
    dirty = false;
    setStatus('Сохранено ✓');
    await openCard(current.contract.id);
  } catch (err) {
    setStatus('Ошибка сохранения: ' + err.message, '#b91c1c');
  }
});

$('btn-eis').addEventListener('click', async () => {
  if (!current) return;
  const items = collectItems();
  if (!items.some(i => i.name && i.okpd2)) {
    setStatus('Добавьте хотя бы одну позицию с наименованием и кодом ОКПД2', '#b45309');
    return;
  }
  setStatus('Сохраняю и формирую файл для ЕИС…', '#b45309');
  try {
    await api(`/api/contracts/${current.contract.id}`, { method: 'PUT', body: JSON.stringify(collectFields()) });
    await api(`/api/contracts/${current.contract.id}/items`, { method: 'PUT', body: JSON.stringify({ items }) });
    dirty = false;
    const a = document.createElement('a');
    a.href = `/api/contracts/${current.contract.id}/eis.xls`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus('Файл для ЕИС сформирован и скачан ✓');
  } catch (err) {
    setStatus('Ошибка: ' + err.message, '#b91c1c');
  }
});

$('btn-delete').addEventListener('click', async () => {
  if (!current) return;
  if (!confirm('Удалить контракт и все его позиции?')) return;
  await api(`/api/contracts/${current.contract.id}`, { method: 'DELETE' });
  showList();
});

$('btn-add-item').addEventListener('click', () => {
  current.items.push({ num: current.items.length + 1, name: '', unit: 'шт', qty: 1, price: '' });
  renderItems();
  dirty = true;
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ---------- Старт ----------
showList();
