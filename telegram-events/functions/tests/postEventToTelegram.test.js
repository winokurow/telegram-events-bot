jest.mock('../mocks/firebase-functions/params');
jest.mock('../mocks/firebase-functions/firebase-admin');
jest.mock('node-fetch', () => jest.fn());
jest.doMock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, handler) => handler,
}));

const fetchMock = require('node-fetch');

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
        json: async () => ({ ok: true, result: { message_id: 777 } }),
    });
});

function ts(date) {
    // Fake Firestore Timestamp-like
    return { toDate: () => new Date(date) };
}

describe('postEventToTelegram', () => {
    beforeEach(() => {
        jest.resetModules();
        jest.doMock('node-fetch', () =>
            jest.fn(() =>
                Promise.resolve({
                    json: async () => ({ ok: true, result: { message_id: 123 } }),
                })
            )
        );
        const fetchMock = require('node-fetch');
    });

    test('skips when postToTelegram=false', async () => {
        const { __test } = require('..');
        const { postEventToTelegramCore } = __test;

        const eventData = { name: 'NoPost', postToTelegram: false };

        await postEventToTelegramCore(eventData, {
            token: 'ENV_TOKEN',
            defaultChatId: '-100123',
            getCategoryChatIds: async () => ['1'], // whatever; it shouldn't be used
            fetchImpl: fetchMock,                   // inject the mocked fetch
        });

        // No Telegram requests should be made
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('sends text only when no image; uses DEFAULT_CHAT_ID; thread==1 omitted', async () => {
        // 1) Reset modules so we can inject mocks before loading the file under test
        jest.resetModules();

        // 2) Mock node-fetch BEFORE requiring index.js
        jest.doMock('node-fetch', () =>
            jest.fn(() =>
                Promise.resolve({
                    json: async () => ({ ok: true, result: { message_id: 123 } }),
                })
            )
        );
        const fetchMock = require('node-fetch'); // this is the mocked fn above

        // Import the testable core from index.js
        const { __test } = require('..');
        const { postEventToTelegramCore } = __test;

        const eventData = {
            name: 'Rock Show',
            category: 'Music',
            place: 'Berlin',
            startDateTime: new Date('2025-06-10T10:00:00Z'),
            // no imageURL
        };

        await postEventToTelegramCore(eventData, {
            token: 'ENV_TOKEN',
            defaultChatId: '-100555',
            // Simulate categories/Music -> ['1'] (topic “general” → omit message_thread_id)
            getCategoryChatIds: async () => ['1'],
            fetchImpl: fetchMock,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.telegram.org/botENV_TOKEN/sendMessage');
        const body = JSON.parse(init.body);
        expect(body.chat_id).toBe('-100555');
        expect(body).not.toHaveProperty('message_thread_id'); // thread==1 -> no topic
        expect(body.text).toMatch(/\*Rock Show\*/);
    });

    describe('postEventToTelegram — image flow', () => {
        test('photo without caption then full text as reply; thread id kept', async () => {
            // 1) reset and mock node-fetch BEFORE requiring index.js
            jest.resetModules();
            jest.doMock('node-fetch', () =>
                jest.fn()
                    // first call: sendPhoto -> ok
                    .mockResolvedValueOnce({ json: async () => ({ ok: true, result: { message_id: 321 } }) })
                    // second call: sendMessage -> ok
                    .mockResolvedValueOnce({ json: async () => ({ ok: true, result: { message_id: 322 } }) })
            );
            const fetchMock = require('node-fetch');

            // 2) load your module after mocks
            const { __test } = await new Promise((resolve) => {
                jest.isolateModules(() => resolve(require('..'))); // functions/index.js
            });
            const { postEventToTelegramCore } = __test;

            // 3) input + deps
            const eventData = {
                name: 'Movie',
                category: 'Cinema',
                place: 'Nürnberg',
                imageURL: 'https://example.com/img.jpg',
                startDateTime: new Date('2025-01-01T18:00:00Z'),
            };

            await postEventToTelegramCore(eventData, {
                token: 'ENV_TOKEN',
                defaultChatId: '-100999',
                getCategoryChatIds: async () => ['11745'], // keep thread id
                // sendInTopic uses module-scoped fetch, already mocked
            });

            // 4) assertions: two calls
            expect(fetchMock).toHaveBeenCalledTimes(2);

            // first: sendPhoto (with thread id)
            const [url1, init1] = fetchMock.mock.calls[0];
            expect(url1).toBe('https://api.telegram.org/botENV_TOKEN/sendPhoto');
            const p1 = JSON.parse(init1.body);
            expect(p1.chat_id).toBe('-100999');
            expect(p1.message_thread_id).toBe(11745);
            expect(p1.photo).toBe('https://example.com/img.jpg');
            expect(p1).not.toHaveProperty('caption'); // no caption in photo

            // second: sendMessage (with thread id)
            const [url2, init2] = fetchMock.mock.calls[1];
            expect(url2).toBe('https://api.telegram.org/botENV_TOKEN/sendMessage');
            const p2 = JSON.parse(init2.body);
            expect(p2.chat_id).toBe('-100999');
            expect(p2.message_thread_id).toBe(11745);
            expect(typeof p2.text).toBe('string');
            expect(p2.text).toMatch(/\*Movie\*/);
        });
    });

    describe('postEventToTelegram – 23:59 Berlin treated as no end time', () => {
        jest.resetModules();
        jest.mock('node-fetch', () => jest.fn());
        const fetchMock = require('node-fetch');
        fetchMock.mockResolvedValue({ json: async () => ({ ok: true, result: { message_id: 1 } }) });

        const { __test } = require('..');                 // <-- make sure your index.js exports __test
        const { postEventToTelegramCore } = __test;

        test('23:59 Berlin -> no time range', async () => {
            const eventData = {
                name: 'All-day',
                category: 'Music',
                place: 'Berlin',
                startDateTime: new Date('2025-06-10T08:00:00Z'),
                endDateTime:   new Date('2025-06-10T21:59:00Z'),
            };
            const deps = {
                token: 'ENV_TOKEN',                           // <-- REQUIRED here
                defaultChatId: '-100777',
                getCategoryChatIds: async () => ['1'],        // thread 1 => no topic
                fetchImpl: fetchMock,
            };

            await postEventToTelegramCore(eventData, deps);

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toBe('https://api.telegram.org/botENV_TOKEN/sendMessage'); // <-- token present
            const body = JSON.parse(init.body);
            expect(body.chat_id).toBe('-100777');
            expect(body).not.toHaveProperty('message_thread_id');                  // thread 1 omitted
            expect(body.text).toContain('*All\\-day*');
            expect(body.text).not.toMatch(/–\s*\d{1,2}:\d{2}/);
        });
    });
});

