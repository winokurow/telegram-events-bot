const values = {
    TELEGRAM_TOKEN: 'TEST_TOKEN',
    DEFAULT_CHAT_ID: '-1001234567890',
    TG_WEBHOOK_SECRET: 'WHK_SECRET',
};
function defineSecret(name) {
    return { value: () => values[name] };
}
module.exports = { defineSecret };




