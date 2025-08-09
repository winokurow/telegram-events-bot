const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { defineSecret }     = require('firebase-functions/params');
const fetch = require("node-fetch");
const { onDocumentCreated } = require('firebase-functions/v2/firestore');

admin.initializeApp();

// Retrieve token & default chat ID from environment config
const telegramToken = defineSecret('TELEGRAM_TOKEN');
const defaultChatId = defineSecret('DEFAULT_CHAT_ID');

exports.handleTelegramStart = functions.https.onRequest(
    { secrets: [telegramToken, defaultChatId] },
    async (req, res) => {
    try {
        const body = req.body;

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
            text: '👋 Welcome to Events Bot! Choose what you’d like to do:',
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: "➕ Add Event",
                        web_app: { url: "https://telegram-events-bot-eb897.web.app/index.html" }
                    },
                    {
                        text: "🔍 Search Events",
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
        console.log('Bot token:', TELEGRAM_TOKEN);
        console.log('Default chat ID:', DEFAULT_CHAT_ID);
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

        // Example: “June 10, 2025 10:00 – June 12, 2025 18:00”
        if (endDate) {
          // If same day, show time range
          if (
            startDate.getFullYear() === endDate.getFullYear() &&
                    startDate.getMonth() === endDate.getMonth() &&
                    startDate.getDate() === endDate.getDate()
          ) {
            // Single‐day event
            const dateStr = startDate.toLocaleDateString("en-US", {dateStyle: "long"});
            const startTime = startDate.toLocaleTimeString("en-US", {timeStyle: "short"});
            const endTime = endDate.toLocaleTimeString("en-US", {timeStyle: "short"});
            dateText = `${dateStr} · ${startTime} – ${endTime} (UTC)`;
          } else {
            // Multi‐day event
            const startStr = startDate.toLocaleString("en-US", {
              dateStyle: "long", timeStyle: "short",
            });
            const endStr = endDate.toLocaleString("en-US", {
              dateStyle: "long", timeStyle: "short",
            });
            dateText = `${startStr} UTC – ${endStr} UTC`;
          }
        } else {
          // Only one timestamp provided: treat as single date/time
          dateText = startDate.toLocaleString("en-US", {
            dateStyle: "long", timeStyle: "short",
          }) + " UTC";
        }
      }

      // 2. Look up categories/{category} to get its chatIds
      let chatIds = [];
      try {
        const catDoc = await admin.firestore().doc(`categories/${category}`).get();
        if (catDoc.exists) {
          const data = catDoc.data();
          if (Array.isArray(data.chatIds) && data.chatIds.length > 0) {
            chatIds = data.chatIds.map(String); // ensure all strings
          }
        }
      } catch (err) {
        console.error("Error fetching category doc:", err);
      }
      // If no chatIds found for this category, use default
      if (chatIds.length === 0) {
        chatIds = [DEFAULT_CHAT_ID];
      }

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
      messageText += `🏷️ *Category:* ${categoryEsc}\n`;
      if (tagsEsc) messageText += `🏷️ *Tags:* ${tagsEsc}\n`;
      if (dateText) messageText += `📅 *When:* ${escapeMarkdownV2(dateText)}\n`;
      messageText += `📍 *Where:* ${placeEsc}\n`;
      if (priceEsc) messageText += `💰 *Price:* ${priceEsc}\n`;
      if (linkEsc) messageText += `🔗 [More info](${linkEsc})\n`;
      if (contactEsc)messageText += `📞 *Contact:* ${contactEsc}\n`;
      if (descEsc) {
        messageText += `\n${descEsc}\n`;
      }
      messageText += `\n— Posted by Event Bot`;

      // 4. Send to each chat ID
      const sendPromises = chatIds.map(async (chatId) => {
          chatId = String(chatId).trim().replace(/^id:\s*/, '');
          try {
          if (imageURL) {
            // Send photo + caption
            const photoPayload = {
              chat_id: chatId,
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
              console.error(`Telegram error sendPhoto (${chatId}):`, json);
            }
          } else {
            // Send text message only
            const msgPayload = {
              chat_id: chatId,
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
              console.error(`Telegram error sendMessage (${chatId}):`, json);
            }
          }
        } catch (err) {
          console.error(`Error posting to Telegram (${chatId}):`, err);
        }
      });

      await Promise.all(sendPromises);
      return null;
    });
