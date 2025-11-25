const store = {
    rate_limits: {},        // per chat doc
    categories: {},         // e.g. { Music: { chatIds: ['1234','1'] } }
};
const admin = {
    initializeApp: jest.fn(),
    firestore: jest.fn(() => ({
        doc: (path) => {
            const [col, id] = path.split('/');
            return {
                async get() {
                    const data = store[col]?.[id];
                    return { exists: !!data, data: () => data };
                },
                // used by tx.set(...)
                path,
            };
        },
        runTransaction: async (fn) => {
            // very small tx facade
            const tx = {
                async get(ref) {
                    const [_, col, id] = ref.path.match(/^(.+)\/(.+)$/) ? ['', ...ref.path.split('/')] : ['', '', ''];
                    const data = store[col]?.[id];
                    return { exists: !!data, data: () => data };
                },
                set(ref, data, _opts) {
                    const [col, id] = ref.path.split('/');
                    store[col] ||= {};
                    store[col][id] = { ...(store[col][id] || {}), ...data };
                },
            };
            return fn(tx);
        },
        __store: store, // exposed for tests
    })),
};
module.exports = admin;
