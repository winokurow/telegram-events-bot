jest.mock('node-fetch', () => jest.fn());
jest.mock('firebase-admin', () => {
    // Safe firestore mock: never throws in the tx
    return {
        initializeApp: jest.fn(),
        firestore: jest.fn(() => ({
            doc: (path) => ({
                path,
                async get() { return { exists: false, data: () => ({}) }; },
            }),
            runTransaction: async (fn) => {
                const tx = {
                    async get() { return { exists: false, data: () => ({}) }; },
                    set: jest.fn(),
                };
                return fn(tx);
            },
        })),
    };
});

// IMPORTANT: mock secrets so the webhook secret matches the header we’ll send
jest.mock('firebase-functions/params', () => ({
    defineSecret: (name) => ({
        value: () => (
            name === 'TG_WEBHOOK_SECRET' ? 'WHK_SECRET'
                : name === 'TELEGRAM_TOKEN'  ? 'TEST_TOKEN'
                    : name === 'DEFAULT_CHAT_ID' ? '-100123'
                        : ''
        ),
    }),
}));
const fetchMock = require('node-fetch');


describe('handleTelegramStart', () => {
    const makeReqRes = (body = {}, headers = {}) => {
        const req = {
            body,
            get: (h) => headers[h] || '',
        };
        const res = {
            statusCode: 200,
            _sent: null,
            status(code) { this.statusCode = code; return this; },
            send(payload) { this._sent = payload; return this; },
        };
        return { req, res };
    };

    test('401 when webhook secret header is missing/invalid', async () => {
        const mod = require('..'); // functions/index.js
        const { req, res } = makeReqRes({ message: { chat: { id: 1 }, text: '/start' } }, {
            'X-Telegram-Bot-Api-Secret-Token': 'WRONG',
        });
        await mod.handleTelegramStart(req, res);
        expect(res.statusCode).toBe(401);
        expect(res._sent).toBe('unauthorized');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('200 throttled when rate-limit trips', async () => {
        // Force the transaction to throw "rate-limit" once by monkey-patching admin mock
        jest.resetModules();
        const admin = require('firebase-admin');
        // override runTransaction to throw inside callback
        admin.firestore = jest.fn(() => ({
            doc: jest.fn(() => ({ path: 'rate_limits/1', async get(){ return { exists:false, data:()=>({}) }; } })),
            runTransaction: async (fn) => {
                await fn({ get: async()=>({ exists:false, data:()=>({}) }), set: jest.fn() });
                // Simulate throwing inside check (simpler: just throw now)
                throw new Error('rate-limit');
            },
        }));
        const mod = require('..');

        const { req, res } = makeReqRes(
            { message: { chat: { id: 1 }, text: '/start' } },
            { 'X-Telegram-Bot-Api-Secret-Token': 'WHK_SECRET' },
        );
        await mod.handleTelegramStart(req, res);
        expect(res.statusCode).toBe(200);
        expect(res._sent).toBe('throttled');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    test('ignores non-text/non-/start updates', async () => {
        jest.resetModules();
        const mod = require('..');
        const { req, res } = makeReqRes(
            { message: { chat: { id: 1 }, text: 'hello' } },
            { 'X-Telegram-Bot-Api-Secret-Token': 'WHK_SECRET' },
        );
        await mod.handleTelegramStart(req, res);
        expect(res.statusCode).toBe(200);
        expect(res._sent).toBe('Ignored');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    describe('handleTelegramStart – /start happy path', () => {
        test('sends menu with web_app buttons and returns 200', async () => {
            // Reset module registry for a clean import
            jest.resetModules();

            // 1) Mock node-fetch (the module under test imports this)
            jest.doMock('node-fetch', () => jest.fn());
            const fetchMock = require('node-fetch');
            fetchMock.mockReset();
            // Telegram returns ok: true for sendMessage
            fetchMock.mockResolvedValue({
                json: async () => ({ ok: true, result: { message_id: 123 } }),
            });

            // 2) Mock secrets so webhook and token are present
            jest.doMock('firebase-functions/params', () => ({
                defineSecret: (name) => ({
                    value: () =>
                        name === 'TG_WEBHOOK_SECRET' ? 'WHK_SECRET'
                            : name === 'TELEGRAM_TOKEN'  ? 'TEST_TOKEN'
                                : name === 'DEFAULT_CHAT_ID' ? '-100123'
                                    : '',
                }),
            }));

            // 3) Mock firebase-admin with a non-throwing Firestore
            jest.doMock('firebase-admin', () => ({
                initializeApp: jest.fn(),
                firestore: jest.fn(() => ({
                    doc: (path) => ({
                        path,
                        async get() { return { exists: false, data: () => ({}) }; },
                    }),
                    runTransaction: async (fn) => {
                        const tx = {
                            async get() { return { exists: false, data: () => ({}) }; },
                            set: jest.fn(),
                        };
                        return await fn(tx);
                    },
                })),
            }));

            // 4) Load the module under test AFTER mocks
            const { handleTelegramStart } = await new Promise((resolve) => {
                jest.isolateModules(() => resolve(require('..')));
            });

            // 5) Fake req/res
            const req = {
                body: { message: { chat: { id: 42, type: 'private' }, text: '/start' } },
                get: (h) => (h === 'X-Telegram-Bot-Api-Secret-Token' ? 'WHK_SECRET' : ''),
            };
            const res = {
                statusCode: 200,
                _sent: null,
                status(c) { this.statusCode = c; return this; },
                send(p)   { this._sent = p;   return this; },
            };

            // 6) Execute
            await handleTelegramStart(req, res);

            // 7) Assert
            expect(res.statusCode).toBe(200);
            expect(res._sent).toBe('Message sent');

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const [url, init] = fetchMock.mock.calls[0];
            expect(url).toMatch(/https:\/\/api\.telegram\.org\/botTEST_TOKEN\/sendMessage$/);

            const body = JSON.parse(init.body);
            expect(body.chat_id).toBe(42);
            // web_app buttons structure
            expect(body.reply_markup?.inline_keyboard?.[0]?.[0]?.web_app?.url)
                .toContain('/index.html');
            expect(body.reply_markup?.inline_keyboard?.[0]?.[1]?.web_app?.url)
                .toContain('/search.html');
        });
    });

    test('handles Telegram error response', async () => {
        jest.resetModules();
        const fetchMock = require('node-fetch');
        fetchMock.mockReset();
        // Telegram returns ok:false
        fetchMock.mockResolvedValueOnce({
            json: async () => ({ ok: false, error_code: 400, description: 'Bad Request' }),
        });

        const mod = require('..'); // load after mocks

        // Fake req/res
        const req = {
            body: { message: { chat: { id: 99 }, text: '/start' } },
            get: (h) => (h === 'X-Telegram-Bot-Api-Secret-Token' ? 'WHK_SECRET' : ''),
        };
        const res = {
            statusCode: 200, _sent: null,
            status(c){ this.statusCode=c; return this; },
            send(p){ this._sent=p; return this; },
        };

        await mod.handleTelegramStart(req, res);

        expect(res.statusCode).toBe(500);
        expect(res._sent).toBe('Telegram error');        // now stable
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toMatch(/sendMessage$/);
    });
});
describe('handleTelegramStart - telegram error path', () => {
    test('returns 500 "Telegram error" when Telegram responds ok:false', async () => {
        // 1) Set up mocks BEFORE loading the module under test
        jest.resetModules();

        // Mock node-fetch (the module your code requires)
        jest.doMock('node-fetch', () => jest.fn());
        const fetchMock = require('node-fetch');
        fetchMock.mockReset();
        // Force Telegram API to return { ok: false, ... }
        fetchMock.mockResolvedValue({
            json: async () => ({ ok: false, error_code: 400, description: 'Bad Request' }),
        });

        // Mock firebase-functions/params (secrets)
        jest.doMock('firebase-functions/params', () => ({
            defineSecret: (name) => ({
                value: () => (
                    name === 'TG_WEBHOOK_SECRET' ? 'WHK_SECRET'
                        : name === 'TELEGRAM_TOKEN'  ? 'TEST_TOKEN'
                            : name === 'DEFAULT_CHAT_ID' ? '-100123'
                                : ''
                ),
            }),
        }));

        // Mock firebase-admin with safe Firestore (no throws)
        jest.doMock('firebase-admin', () => {
            return {
                initializeApp: jest.fn(),
                firestore: jest.fn(() => ({
                    doc: (path) => ({
                        path,
                        async get() { return { exists: false, data: () => ({}) }; },
                    }),
                    runTransaction: async (fn) => {
                        // minimal tx that never throws
                        const tx = {
                            async get() { return { exists: false, data: () => ({}) }; },
                            set: jest.fn(),
                        };
                        return await fn(tx);
                    },
                })),
            };
        });

        // 2) Load the module under test in an isolated context
        const { handleTelegramStart } = await new Promise((resolve) => {
            jest.isolateModules(() => {
                // require AFTER mocks so they take effect
                const mod = require('..'); // functions/index.js
                resolve(mod);
            });
        });

        // 3) Fake req/res
        const req = {
            body: { message: { chat: { id: 99 }, text: '/start' } },
            get: (h) => (h === 'X-Telegram-Bot-Api-Secret-Token' ? 'WHK_SECRET' : ''),
        };
        const res = {
            statusCode: 200,
            _sent: null,
            status(c) { this.statusCode = c; return this; },
            send(p) { this._sent = p; return this; },
        };

        // 4) Execute
        await handleTelegramStart(req, res);

        // 5) Assert: we stayed inside the "Telegram error" branch (not the outer catch)
        expect(res.statusCode).toBe(500);
        expect(res._sent).toBe('Telegram error');

        // Sanity: fetch was called exactly once with sendMessage
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toMatch(/\/sendMessage$/);
    });
});
