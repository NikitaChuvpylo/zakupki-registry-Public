// Забор PDF-контрактов из почты по IMAP.
// Учётные данные ТОЛЬКО из переменных окружения (никогда не хранить в коде/БД):
//   MAIL_IMAP_HOST — например imap.mail.ru (по умолчанию imap.mail.ru)
//   MAIL_USER — адрес почты
//   MAIL_APP_PASSWORD — пароль ПРИЛОЖЕНИЯ (не обычный пароль от почты!)
//   MAIL_FOLDER — папка для проверки (по умолчанию INBOX)
//
// Логика: подключаемся, смотрим письма (по умолчанию — не старше MAIL_LOOKBACK_DAYS,
// по умолчанию 60 дней), у каждого письма сверяем Message-ID со своей таблицей
// mail_seen (чтобы не забирать повторно), и только для новых писем скачиваем
// PDF-вложения. Само содержимое письма никак не меняем и не помечаем — почта
// пользователя остаётся как есть, дедупликация только в нашей базе.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

function envOrThrow(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name} (настройте её в Railway → Variables)`);
  return v;
}

/**
 * @param {(pdf: {buffer: Buffer, filename: string, messageId: string, subject: string}) => Promise<void>} onPdfFound
 *        вызывается для каждого нового PDF-вложения из ещё не обработанного письма
 * @param {(messageId: string) => boolean} isSeen — вернуть true, если это письмо уже обработано
 * @returns {Promise<{checked: number, newMessages: number, pdfsFound: number, errors: string[]}>}
 */
export async function fetchContractPdfsFromMail(onPdfFound, isSeen) {
  const host = process.env.MAIL_IMAP_HOST || 'imap.mail.ru';
  const user = envOrThrow('MAIL_USER');
  const pass = envOrThrow('MAIL_APP_PASSWORD');
  const folder = process.env.MAIL_FOLDER || 'INBOX';
  const lookbackDays = Number(process.env.MAIL_LOOKBACK_DAYS || 60);

  const client = new ImapFlow({
    host,
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const stats = { checked: 0, newMessages: 0, pdfsFound: 0, errors: [] };

  await client.connect();
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      const since = new Date(Date.now() - lookbackDays * 24 * 3600 * 1000);
      // Сначала лёгкий проход: только конверт (тема, Message-ID, дата) — без скачивания тела.
      // Так мы быстро пропускаем уже виденные письма, не тратя трафик/время на них.
      const candidates = [];
      for await (const msg of client.fetch({ since }, { envelope: true, uid: true })) {
        stats.checked++;
        const messageId = (msg.envelope && msg.envelope.messageId) || `uid-${msg.uid}`;
        if (isSeen(messageId)) continue;
        candidates.push({ uid: msg.uid, messageId, subject: (msg.envelope && msg.envelope.subject) || '' });
      }

      for (const cand of candidates) {
        try {
          const full = await client.fetchOne(cand.uid, { source: true });
          if (!full || !full.source) continue;
          const parsed = await simpleParser(full.source);
          const pdfAttachments = (parsed.attachments || []).filter(a =>
            (a.contentType && a.contentType.toLowerCase() === 'application/pdf') ||
            /\.pdf$/i.test(a.filename || '')
          );
          if (!pdfAttachments.length) continue;
          stats.newMessages++;
          for (const att of pdfAttachments) {
            stats.pdfsFound++;
            await onPdfFound({
              buffer: att.content,
              filename: att.filename || `contract_${cand.uid}.pdf`,
              messageId: cand.messageId,
              subject: cand.subject,
            });
          }
        } catch (e) {
          stats.errors.push(`Письмо "${cand.subject}": ${e.message}`);
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return stats;
}
