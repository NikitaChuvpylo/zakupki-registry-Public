<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Реестр малых закупок</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>Реестр малых закупок</h1>
    <div class="header-actions">
      <label class="btn btn-primary" for="pdf-upload">+ Загрузить PDF или фото</label>
      <input type="file" id="pdf-upload" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp" multiple hidden>
      <button id="btn-fetch-mail" class="btn btn-ghost" title="Проверить почту на новые контракты">📧 Забрать письма</button>
      <span id="upload-status" class="status"></span>
    </div>
  </header>

  <main>
    <!-- Список -->
    <section id="list-view">
      <div class="toolbar">
        <input type="search" id="search" placeholder="Поиск: номер, поставщик, заказчик, ИНН, ИКЗ…">
        <select id="status-filter">
          <option value="">Все статусы</option>
          <option value="active">Активен</option>
          <option value="done">Исполнен</option>
          <option value="terminated">Расторгнут</option>
        </select>
      </div>
      <table id="contracts-table">
        <thead>
          <tr>
            <th>№ контракта</th>
            <th>Дата</th>
            <th>Поставщик</th>
            <th>Сумма</th>
            <th>Позиций</th>
            <th>Статус</th>
            <th></th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
      <p id="empty-hint" class="hint hidden">Пока нет контрактов. Нажмите «+ Загрузить PDF», чтобы добавить первый.</p>
    </section>

    <!-- Карточка -->
    <section id="card-view" class="hidden">
      <div class="card-top">
        <button id="btn-back" class="btn">← К списку</button>
        <h2 id="card-title">Контракт</h2>
        <div class="card-actions">
          <button id="btn-recognize" class="btn">🔍 Распознать спецификацию</button>
          <button id="btn-save" class="btn btn-primary">Сохранить</button>
          <button id="btn-eis" class="btn btn-success">⬇ Скачать для ЕИС</button>
          <button id="btn-delete" class="btn btn-danger">Удалить</button>
        </div>
      </div>
      <p id="card-status" class="status"></p>

      <div class="card-layout">
        <div class="card-fields">
          <h3>Реквизиты контракта</h3>
          <label>Номер контракта
            <input id="f-num" type="text">
          </label>
          <label>Дата
            <input id="f-date" type="date">
          </label>
          <label>Заказчик
            <input id="f-customer" type="text">
          </label>
          <label>ИНН заказчика
            <input id="f-customer-inn" type="text">
          </label>
          <label>Поставщик
            <input id="f-supplier" type="text">
          </label>
          <label>ИНН поставщика
            <input id="f-supplier-inn" type="text">
          </label>
          <label>ИКЗ
            <input id="f-ikz" type="text">
          </label>
          <div class="row2">
            <label>Сумма, ₽
              <input id="f-total" type="number" step="0.01">
            </label>
            <label>Ставка НДС
              <select id="f-vat">
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="0">0</option>
                <option value="">Без НДС</option>
              </select>
            </label>
          </div>
          <label>Статус
            <select id="f-status">
              <option value="active">Активен</option>
              <option value="done">Исполнен</option>
              <option value="terminated">Расторгнут</option>
            </select>
          </label>
        </div>

        <div class="card-pdf">
          <h3>Документ</h3>
          <div id="pdf-pages" class="pdf-pages"></div>
          <p class="hint" id="no-pages-hint">Страницы появятся после загрузки PDF.</p>
        </div>
      </div>

      <h3>Позиции спецификации</h3>
      <p class="hint">Колонки соответствуют шаблону ЕИС «Объекты закупки». Код ОКЕИ и сумма считаются автоматически.</p>
      <div id="items-total" class="hint hidden" style="margin-bottom:6px"></div>
      <div class="table-wrap">
        <table id="items-table">
          <thead>
            <tr>
              <th>№</th>
              <th>Наименование</th>
              <th>ОКПД2</th>
              <th>Ед.</th>
              <th>Кол-во</th>
              <th>Цена, ₽</th>
              <th>Сумма, ₽</th>
              <th>ГОСТ / стандарт</th>
              <th>Характеристики</th>
              <th></th>
            </tr>
          </thead>
          <tbody></tbody>
          <tfoot id="items-tfoot" class="hidden">
            <tr>
              <td colspan="4" style="text-align:right">ИТОГО:</td>
              <td id="tfoot-qty"></td>
              <td></td>
              <td id="tfoot-sum"></td>
              <td colspan="3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="items-actions">
        <button id="btn-add-item" class="btn">+ Добавить позицию</button>
      </div>
    </section>
  </main>

  <script src="app.js"></script>
</body>
</html>
