const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { defineSecret }     = require('firebase-functions/params');
const fetch = require("node-fetch");
const { onDocumentCreated } = require('firebase-functions/v2/firestore');

admin.initializeApp();

// Retrieve token & default chat ID from environment config
const telegramToken = defineSecret('TELEGRAM_TOKEN');
const defaultChatId = defineSecret('DEFAULT_CHAT_ID');
const tgWebhookSecret = defineSecret('TG_WEBHOOK_SECRET');

async function checkChatCooldown(chatId, maxPerMinute = 5) {
    const ref = admin.firestore().doc(`rate_limits/${String(chatId)}`);
    await admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = Date.now(), windowMs = 60_000;
        let data = { hits: 0, resetAt: now + windowMs };
        if (snap.exists) data = snap.data();
        if (now > data.resetAt) { data.hits = 0; data.resetAt = now + windowMs; }
        data.hits++;
        if (data.hits > maxPerMinute) throw new Error('rate-limit');
        tx.set(ref, data, { merge: true });
    });
}

exports.handleTelegramStart = functions.https.onRequest(
    { secrets: [telegramToken, defaultChatId, tgWebhookSecret] },
    async (req, res) => {
    try {
        // 1) verify Telegram secret header
        const got = req.get('X-Telegram-Bot-Api-Secret-Token') || '';
        const need = tgWebhookSecret.value() || '';
        if (!need || got !== need) {
            console.warn('Rejecting webhook: invalid secret header');
            return res.status(401).send('unauthorized');
        }

        const body = req.body;
        try {
            await checkChatCooldown(body.message.chat.id, 5);
        } catch {
            // politely ignore or reply with throttled
            return res.status(200).send('throttled');
        }

        // Check if it's a message (ignore other update types like callback_query)
        if (!body.message || !body.message.text) {
            console.log("Not a message update or no text");
            return res.status(200).send("OK (not a message)");
        }

        const token = telegramToken.value()?.trim();
        if (!token) {
            console.error('❌ TELEGRAM_TOKEN not set');
            return res.status(200).send('OK (no token)');
        }

        const chatId = body.message.chat.id;
        const messageText = body.message.text;

        if (messageText !== '/start') {
            console.log("Ignoring message:", messageText);
            return res.status(200).send("Ignored");
        }

        const message = {
            chat_id: chatId,
            text: '👋 Добро пожаловать. Я бот афишы города Нюрнберга! Вы можете:',
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: "➕ Добавить новое мероприятие",
                        web_app: { url: "https://telegram-events-bot-eb897.web.app/index.html" }
                    },
                    {
                        text: "🔍 Найти мероприятие",
                        web_app: { url: "https://telegram-events-bot-eb897.web.app/search.html" }
                    }
                ]]
            }
        };

        const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
        });

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
});

// Helper to escape MarkdownV2 special characters
function escapeMarkdownV2(text) {
  return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// Вспомогательная функция для получения часов и минут в указанной таймзоне
function getTimeInTimeZone(date, timeZone) {
    const fmt = new Intl.DateTimeFormat('ru-RU', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const hours = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const minutes = parseInt(parts.find(p => p.type === 'minute').value, 10);
    return { hours, minutes };
}

// Проверка: время конца считается не заданным, если оно равно 23:59 в Германии
function isTimeEmptyInBerlin(date) {
    const { hours, minutes } = getTimeInTimeZone(date, 'Europe/Berlin');
    return hours === 23 && minutes === 59;
}


exports.postEventToTelegram = onDocumentCreated(
    { document: 'events/{eventId}',
        region: 'europe-west3',
        secrets:  [telegramToken, defaultChatId]},
    async (event) => {
        const TELEGRAM_TOKEN    = process.env.TELEGRAM_TOKEN;
        const DEFAULT_CHAT_ID   = process.env.DEFAULT_CHAT_ID;
        const snap = event.data;           // a DocumentSnapshot
        if (!snap) return null;
        const eventData = snap.data();

        // Default behavior: if field is missing, we DO post (backward-compatible)
        if (eventData.hasOwnProperty('postToTelegram') && eventData.postToTelegram === false) {
            console.log(`postEventToTelegram: skipped for ${snap.id} (postToTelegram=false)`);
            return null;
        }

        // 1. Build the message components
      const name = eventData.name || "Untitled Event";
      const category = eventData.category || "Uncategorized";
      const tagsArray = Array.isArray(eventData.tags) ? eventData.tags : [];
      const description = eventData.description || "";
      const place = eventData.place || "No location specified";
      const price = eventData.price || "";
      const link = eventData.link || "";
      const contact = eventData.contact || "";
      const imageURL = eventData.imageURL || null;

        // Date & time formatting: convert Firestore Timestamp to JS Date, then to formatted string
        let dateText = "";
        if (eventData.startDateTime && typeof eventData.startDateTime.toDate === "function") {
            const startDate = eventData.startDateTime.toDate();
            const endDate = (eventData.endDateTime && eventData.endDateTime.toDate()) ?
                eventData.endDateTime.toDate() :
                null;

            // Форматируем даты по-русски, время по Берлину
            if (endDate) {
                const sameDay =
                    startDate.getFullYear() === endDate.getFullYear() &&
                    startDate.getMonth() === endDate.getMonth() &&
                    startDate.getDate() === endDate.getDate();

                const formatDate = (date) =>
                    date.toLocaleDateString('ru-RU', {
                        timeZone: 'Europe/Berlin',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    });

                const formatTime = (date) =>
                    date.toLocaleTimeString('ru-RU', {
                        timeZone: 'Europe/Berlin',
                        hour: '2-digit',
                        minute: '2-digit',
                    });

                if (sameDay) {
                    // Однодневное событие
                    const dateStr = formatDate(startDate);

                    if (!isTimeEmptyInBerlin(endDate)) {
                        // Конец задан → показываем время
                        const startTime = formatTime(startDate);
                        const endTime = formatTime(endDate);
                        dateText = `${dateStr} · ${startTime} – ${endTime}`;
                    } else {
                        // Конец "23:59" → показываем только дату
                        dateText = dateStr;
                    }
                } else {
                    // Многодневное событие — две строки
                    const startStr = `${formatDate(startDate)}, ${formatTime(startDate)}`;

                    let endStr = formatDate(endDate);
                    if (!isTimeEmptyInBerlin(endDate)) {
                        endStr += `, ${formatTime(endDate)}`;
                    }

                    dateText = `Начало: ${startStr}\nКонец:  ${endStr}`;
                }
            } else {
                // Только начало
                const formatDate = (date) =>
                    date.toLocaleDateString('ru-RU', {
                        timeZone: 'Europe/Berlin',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    });

                const formatTime = (date) =>
                    date.toLocaleTimeString('ru-RU', {
                        timeZone: 'Europe/Berlin',
                        hour: '2-digit',
                        minute: '2-digit',
                    });

                dateText = `${formatDate(startDate)}, ${formatTime(startDate)}`;
            }
        }

      // 2. Look up categories/{category} to get its chatIds
      let threadIds = [];
      try {
        const catDoc = await admin.firestore().doc(`categories/${category}`).get();
        if (catDoc.exists) {
          const data = catDoc.data();
          if (Array.isArray(data.chatIds) && data.chatIds.length > 0) {
              threadIds = data.chatIds.map(String); // ensure all strings
          }
        }
      } catch (err) {
        console.error("Error fetching category doc:", err);
      }
      // If no chatIds found for this category, use default
      //if (chatIds.length === 0) {
        chatIds = [DEFAULT_CHAT_ID];
      //}
        console.log('chatIds:', chatIds);
      // 3. Construct the MarkdownV2 message
      // Escape all fields carefully
      const nameEsc = escapeMarkdownV2(name);
      const categoryEsc = escapeMarkdownV2(category);
      const placeEsc = escapeMarkdownV2(place);
      const priceEsc = escapeMarkdownV2(price);
      const linkEsc = escapeMarkdownV2(link);
      const contactEsc = escapeMarkdownV2(contact);
      const descEsc = escapeMarkdownV2(description);
      const tagsEscArray = tagsArray.map((tag) => escapeMarkdownV2(tag));
      const tagsEsc = tagsEscArray.length
            ? tagsEscArray
                .map(tag => `\\#${escapeMarkdownV2(tag)}`)
                .join(' ')
            : '';

      let messageText = `*${nameEsc}*\n`;
      if (dateText) messageText += `📅 *Время:* ${escapeMarkdownV2(dateText)}\n`;
      messageText += `📍 *Место:* ${placeEsc}\n`;
      if (priceEsc) messageText += `💰 *Цена:* ${priceEsc}\n`;
      if (linkEsc) messageText += `🔗 [Детали](${linkEsc})\n`;
      if (contactEsc)messageText += `📞 *Контакты:* ${contactEsc}\n`;
      if (descEsc) {
        messageText += `\n${descEsc}\n`;
      }

      // 4. Send to each chat ID
      const sendPromises = threadIds.map(async (threadId) => {
          threadId = String(threadId).trim().replace(/^id:\s*/, '');
          try {
          if (imageURL) {
            // Send photo + caption
            const photoPayload = {
              chat_id: DEFAULT_CHAT_ID,
              message_thread_id: threadId,
              photo: imageURL,
              caption: messageText,
              parse_mode: "MarkdownV2",
            };
            const res = await fetch(
                `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`,
                {
                  method: "POST",
                  headers: {"Content-Type": "application/json"},
                  body: JSON.stringify(photoPayload),
                },
            );
            const json = await res.json();
            if (!json.ok) {
              console.error(`Telegram error sendPhoto (${threadId}):`, json);
            }
          } else {
            // Send text message only
            const msgPayload = {
              chat_id: DEFAULT_CHAT_ID,
              message_thread_id: threadId,
              text: messageText,
              parse_mode: "MarkdownV2",
              disable_web_page_preview: true,
            };
              console.log(msgPayload);
            const res = await fetch(
                `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
                {
                  method: "POST",
                  headers: {"Content-Type": "application/json"},
                  body: JSON.stringify(msgPayload),
                },
            );
            const json = await res.json();
            if (!json.ok) {
              console.error(`Telegram error sendMessage (${threadId}):`, json);
            }
          }
        } catch (err) {
          console.error(`Error posting to Telegram (${threadId}):`, err);
        }
      });

      await Promise.all(sendPromises);
      return null;
    });
