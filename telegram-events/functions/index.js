const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { defineSecret } = require("firebase-functions/params");
const fetch = require("node-fetch");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const FormData = require('form-data');

admin.initializeApp();

// Retrieve token & default chat ID from environment config
const telegramToken = defineSecret("TELEGRAM_TOKEN");
const defaultChatId = defineSecret("DEFAULT_CHAT_ID");
const tgWebhookSecret = defineSecret("TG_WEBHOOK_SECRET");

async function checkChatCooldown(chatId, maxPerMinute = 5) {
  const ref = admin.firestore().doc(`rate_limits/${String(chatId)}`);
  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now(),
      windowMs = 60_000;
    let data = { hits: 0, resetAt: now + windowMs };
    if (snap.exists) data = snap.data();
    if (now > data.resetAt) {
      data.hits = 0;
      data.resetAt = now + windowMs;
    }
    data.hits++;
    if (data.hits > maxPerMinute) throw new Error("rate-limit");
    tx.set(ref, data, { merge: true });
  });
}

exports.handleTelegramStart = functions.https.onRequest(
  { secrets: [telegramToken, defaultChatId, tgWebhookSecret] },
  async (req, res) => {
    try {
      // 1) verify Telegram secret header
      const got = req.get("X-Telegram-Bot-Api-Secret-Token") || "";
      const need = tgWebhookSecret.value() || "";
      if (!need || got !== need) {
        console.warn("Rejecting webhook: invalid secret header");
        return res.status(401).send("unauthorized");
      }

      const body = req.body;
      try {
        await checkChatCooldown(body.message.chat.id, 5);
      } catch {
        // politely ignore or reply with throttled
        return res.status(200).send("throttled");
      }

      // Check if it's a message (ignore other update types like callback_query)
      if (!body.message || !body.message.text) {
        console.log("Not a message update or no text");
        return res.status(200).send("OK (not a message)");
      }

      const token = telegramToken.value()?.trim();
      if (!token) {
        console.error("❌ TELEGRAM_TOKEN not set");
        return res.status(200).send("OK (no token)");
      }

      const chatId = body.message.chat.id;
      const messageText = body.message.text;

      if (messageText !== "/start") {
        console.log("Ignoring message:", messageText);
        return res.status(200).send("Ignored");
      }

      const message = {
        chat_id: chatId,
        text: "👋 Добро пожаловать. Я бот афишы города Нюрнберга! Вы можете:",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "➕ Добавить новое мероприятие",
                web_app: {
                  url: "https://telegram-events-bot-eb897.web.app/index.html",
                },
              },
              {
                text: "🔍 Найти мероприятие",
                web_app: {
                  url: "https://telegram-events-bot-eb897.web.app/search.html",
                },
              },
            ],
          ],
        },
      };

      const tgRes = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message),
        },
      );

      const tgJson = await tgRes.json();

      if (!tgJson.ok) {
        console.error("Telegram sendMessage error:", tgJson);
        return res.status(500).send("Telegram error");
      }

      res.status(200).send("Message sent");
    } catch (err) {
      console.error("Error in /handleTelegramStart:", err);
      res.status(500).send("Internal Server Error");
    }
  },
);

function normalizeThreadId(t) {
  if (t == null) return null;
  const s = String(t).trim().toLowerCase();
  if (s === '' || s === '0' || s === '1' || s === 'general') return null;
  return /^\d+$/.test(s) ? Number(s) : s;
}

// Build RU/EU-Berlin date text, honoring 23:59=unspecified end
function buildDateText(startDate, endDate) {
  if (!startDate) return '';
  const fmtDate = (d) => d.toLocaleDateString('ru-RU', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: 'long', day: 'numeric',
  });
  const fmtTime = (d) => d.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit',
  });

  if (endDate) {
    const same = startDate.getFullYear()===endDate.getFullYear()
        && startDate.getMonth()===endDate.getMonth()
        && startDate.getDate()===endDate.getDate();

    if (same) {
      const ds = fmtDate(startDate);
      if (!isTimeEmptyInBerlin(endDate)) {
        return `${ds} · ${fmtTime(startDate)} – ${fmtTime(endDate)}`;
      }
      return ds; // 23:59 -> show only date
    } else {
      const startStr = `${fmtDate(startDate)}, ${fmtTime(startDate)}`;
      let endStr = fmtDate(endDate);
      if (!isTimeEmptyInBerlin(endDate)) endStr += `, ${fmtTime(endDate)}`;
      return `Начало: ${startStr}\nКонец:  ${endStr}`;
    }
  }
  return `${fmtDate(startDate)}, ${fmtTime(startDate)}`;
}

function buildMessageText({ name, tagsArray, dateText, place, price, link, contact, description }) {
  const nameEsc = escapeMarkdownV2(name || 'Untitled Event');
  const placeEsc = escapeMarkdownV2(place || '');
  const priceEsc = escapeMarkdownV2(price || '');
  const contactEsc = escapeMarkdownV2(contact || '');
  const descEsc = escapeMarkdownV2(description || '');
  const tagsEsc = Array.isArray(tagsArray) && tagsArray.length
      ? tagsArray.map(t => `\\#${escapeMarkdownV2(t)}`).join(' ')
      : '';

  let text = `*${nameEsc}*\n`;
  if (tagsEsc) text += `🏷️ *Tags:* ${tagsEsc}\n`;
  if (dateText) text += `📅 *Время:* ${escapeMarkdownV2(dateText)}\n`;
  if (placeEsc) text += `📍 *Место:* ${placeEsc}\n`;
  if (priceEsc) text += `💰 *Цена:* ${priceEsc}\n`;
  if (link)     text += `🔗 [Детали](${link})\n`;
  if (contactEsc) text += `📞 *Контакты:* ${contactEsc}\n`;
  if (descEsc)  text += `\n${descEsc}\n`;
  return text.trim();
}

function toDateMaybe(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  return new Date(v);
}

// Helper to escape MarkdownV2 special characters
function escapeMarkdownV2(text) {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// Вспомогательная функция для получения часов и минут в указанной таймзоне
function getTimeInTimeZone(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hours = parseInt(parts.find((p) => p.type === "hour").value, 10);
  const minutes = parseInt(parts.find((p) => p.type === "minute").value, 10);
  return { hours, minutes };
}

// Проверка: время конца считается не заданным, если оно равно 23:59 в Германии
function isTimeEmptyInBerlin(date) {
  const { hours, minutes } = getTimeInTimeZone(date, "Europe/Berlin");
  return hours === 23 && minutes === 59;
}

// Turn Firebase download URL into "path/in/bucket.jpg"
function extractStoragePathFromUrl(downloadUrl) {
  try {
    const url = new URL(downloadUrl);
    const afterO = url.pathname.split('/o/')[1];
    if (!afterO) return null;
    return decodeURIComponent(afterO); // e.g. "eventImages/.../PARKS_event_nm2025.jpg"
  } catch {
    return null;
  }
}

// Read from Firebase Storage (Admin SDK) and send via Telegram as multipart/form-data
async function sendPhotoFromStorage(token, chatId, threadId, downloadUrl) {
  const path = extractStoragePathFromUrl(downloadUrl);
  if (!path) {
    throw new Error('Cannot parse storage path from imageURL');
  }

  const bucket = admin.storage().bucket(); // default bucket
  const file = bucket.file(path);
  const [buffer] = await file.download();
  const filename = path.split('/').pop() || 'image.jpg';

  const form = new FormData();
  form.append('chat_id', chatId);
  if (threadId != null && threadId !== '1') {
    form.append('message_thread_id', threadId);
  }
  form.append('photo', buffer, { filename });

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    body: form,
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) {
    throw new Error(
        `sendPhoto: ${j.description || res.status + ' ' + res.statusText}`,
    );
  }
  return j;
}

async function sendInTopic(token, chatId, threadId, method, payload) {
  const p = { chat_id: chatId, ...payload };
  if (threadId != null && threadId !== "1") {
    p.message_thread_id = threadId;
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) {
    console.error(j.description + res.statusText);
    throw new Error(
        `${method}: ${j.description || res.status + " " + res.statusText}`,
    );
  }
  return j;
}

/**
 * CORE (testable): sends an event to Telegram using your sendInTopic.
 * deps: { token, defaultChatId, getCategoryChatIds(category)->Promise<string[]>, fetchImpl (optional) }
 */
async function postEventToTelegramCore(eventData, deps) {
  const {
    token,
    defaultChatId,
    getCategoryChatIds = async (category) => {
      const doc = await admin.firestore().doc(`categories/${category}`).get();
      if (doc.exists && Array.isArray(doc.data().chatIds) && doc.data().chatIds.length) {
        return doc.data().chatIds.map(String);
      }
      return [];
    },
  } = deps;

  // honor skip flag
  if (eventData.hasOwnProperty('postToTelegram') && eventData.postToTelegram === false) {
    return { sent: false, reason: 'postToTelegram=false' };
  }

  const name = eventData.name || 'Untitled Event';
  const category = eventData.category || 'Uncategorized';
  const tagsArray = Array.isArray(eventData.tags) ? eventData.tags : [];
  const description = eventData.description || '';
  const place = eventData.place || '';
  const price = eventData.price || '';
  const link = eventData.link || '';
  const contact = eventData.contact || '';
  const imageURL = eventData.imageURL || null;

  const start = toDateMaybe(eventData.startDateTime);
  const end   = toDateMaybe(eventData.endDateTime);
  const dateText = start ? buildDateText(start, end) : '';

  const messageText = buildMessageText({ name, tagsArray, dateText, place, price, link, contact, description });

  let threadIds = [];
  try { threadIds = await getCategoryChatIds(category); } catch {}
  if (!threadIds || !threadIds.length) threadIds = [null];

  const results = [];
  for (const raw of threadIds) {
    const threadId = normalizeThreadId(raw);

    if (imageURL) {
      // 1) send photo from Firebase Storage bytes
      const photoMsg = await sendPhotoFromStorage(
          token,
          defaultChatId,
          threadId,
          imageURL,
      );

      // 2) send text as reply (your existing logic)
      try {
        await sendInTopic(
            token,
            defaultChatId,
            threadId,
            "sendMessage",
            {
              text: messageText,
              parse_mode: "MarkdownV2",
              disable_web_page_preview: true,
              reply_to_message_id: photoMsg?.result?.message_id,
              allow_sending_without_reply: true,
            },
        );
      } catch (e) {
        // fallback without MarkdownV2 if escaping breaks
        await sendInTopic(
            token,
            defaultChatId,
            threadId,
            "sendMessage",
            {
              text: messageText,
              disable_web_page_preview: true,
              reply_to_message_id: photoMsg?.result?.message_id,
              allow_sending_without_reply: true,
            },
        );
      }
    } else {
      try {
        await sendInTopic(token, defaultChatId, threadId, 'sendMessage', {
          text: messageText,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        });
      } catch {
        await sendInTopic(token, defaultChatId, threadId, 'sendMessage', {
          text: messageText,
          disable_web_page_preview: true,
        });
      }
      results.push({ threadId, kind: 'text' });
    }
  }

  return { sent: true, results };
}

// ---------- production trigger still uses onDocumentCreated ----------
exports.postEventToTelegram = onDocumentCreated(
    {
      document: 'events/{eventId}',
      region: 'europe-west3',
      secrets: [telegramToken, defaultChatId],   // v2 secret injection
    },
    async (event) => {
      const snap = event.data;
      if (!snap) return null;
      const eventData = snap.data();

      // Prefer v2 secrets; optionally fall back to env for local/emulator
      const token = telegramToken.value?.() || process.env.TELEGRAM_TOKEN;
      const chat  = defaultChatId.value?.() || process.env.DEFAULT_CHAT_ID;

      await postEventToTelegramCore(eventData, {
        token,
        defaultChatId: chat,
        // real Firestore lookup in prod
        getCategoryChatIds: async (category) => {
          const doc = await admin.firestore().doc(`categories/${category}`).get();
          if (doc.exists && Array.isArray(doc.data().chatIds) && doc.data().chatIds.length) {
            return doc.data().chatIds.map(String);
          }
          return [];
        },
        // uses real fetch
      });

      return null;
    }
);

// ---------- export test hooks so unit tests don’t need CloudEvent ----------
exports.__test = {
  postEventToTelegramCore,
  // optionally: normalizeThreadId, buildDateText, buildMessageText, etc.
};
