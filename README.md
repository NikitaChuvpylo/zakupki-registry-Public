# Реестр малых закупок (zakupki-registry)

Загрузка PDF-контракта → распознавание спецификации → заполнение таблицы → экспорт в Excel
по шаблону ЕИС «Объекты закупки» (для повторного заполнения контракта в ЕИС).

## Локальный запуск

```
npm install
npm start        # http://localhost:3001
```

Требуется Node.js ≥ 20. Русская OCR-модель уже в репозитории: `data/tessdata/rus.traineddata`.

## Публичный деплой на Render (бесплатно)

Файл `render.yaml` уже подготовлен.

### Способ А — через GitHub (рекомендуется)
1. Создайте репозиторий на GitHub и залейте эту папку (без `node_modules`, `.env`, `data/uploads`, `data/contracts`, `data/*.db*`).
2. Зайдите на https://render.com → New → Blueprint.
3. Укажите ваш GitHub-репозиторий. Render сам прочитает `render.yaml` и создаст веб-сервис.
4. Через ~3–5 минут получите ссылку вида `https://zakupki-registry.onrender.com`.

### Способ Б — Web Service вручную
1. https://render.com → New → Web Service → подключите GitHub-репозиторий.
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Free instance. Жмите Create.

### Переменные окружения
Ничего обязательного нет. Опционально:
- `PORT` — Render задаёт сам.
- `MAX_PDF_MB=30` — лимит файла (необязательно).

## Важно про распознавание
- Сервер использует локальный OCR (tesseract.js). На хороших сканах (300 dpi) распознаёт большинство
  строк; на плохих сканах часть позиций может потеряться — их нужно доправить вручную в таблице
  перед скачиванием Excel. Порядок позиций и общая сумма считаются автоматически.
- Для 100% точного распознавания сложных сканов загружайте PDF ассистенту в чат AgentHere —
  он распознает страницы vision-моделью и вернёт готовый Excel/заполнит реестр.

## Файлы
- `server.js` — Express API + статика
- `lib/recognize.mjs` — OCR (tesseract.js + TSV-координаты), сортировка страниц по листам
- `lib/parse-spec.js` — разбор позиций спецификации (qty×price=sum)
- `lib/parse-header.js` — разбор реквизитов контракта
- `lib/eis-excel.js` — генерация .xls по шаблону ЕИС (`data/eis-template.xls`)
- `public/` — интерфейс
