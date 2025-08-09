// theme.js — Telegram Web App dark/light theme support

function applyVars({ bg, text, hint, link, button, buttonText, card, border }, isDark) {
    const r = document.documentElement.style;
    if (bg)        r.setProperty('--bg', bg);
    if (text)      r.setProperty('--text', text);
    if (hint)      r.setProperty('--hint', hint);
    if (link)      r.setProperty('--link', link);
    if (button)    r.setProperty('--button', button);
    if (buttonText)r.setProperty('--button-text', buttonText);
    if (card)      r.setProperty('--card', card);
    if (border)    r.setProperty('--border', border);
    document.documentElement.classList.toggle('dark', !!isDark);

    // Keep Android status bar in sync
    const meta = document.querySelector('meta[name="theme-color"]') || (() => {
        const m = document.createElement('meta');
        m.name = 'theme-color';
        document.head.appendChild(m);
        return m;
    })();
    meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
}

function fromTelegram(tp = {}, scheme = 'light') {
    // Fallback palette if Telegram doesn’t give themeParams (common on Android)
    const fallback = scheme === 'dark'
        ? { bg:'#0f0f0f', text:'#f5f5f5', hint:'#9aa0a6', link:'#5ea0ff', button:'#5ea0ff', buttonText:'#0b0b0b', card:'#1a1a1a', border:'#2a2a2a' }
        : { bg:'#ffffff', text:'#111111', hint:'#6b7280', link:'#0a84ff', button:'#0a84ff', buttonText:'#ffffff', card:'#f5f5f5', border:'#e5e7eb' };

    return {
        bg:         tp.bg_color              || fallback.bg,
        text:       tp.text_color            || fallback.text,
        hint:       tp.hint_color            || fallback.hint,
        link:       tp.link_color            || fallback.link,
        button:     tp.button_color          || fallback.button,
        buttonText: tp.button_text_color     || fallback.buttonText,
        card:       tp.secondary_bg_color    || fallback.card,
        border:     tp.section_separator_color || fallback.border
    };
}



function initTheme() {function initTheme() {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (!tg) {
        // Browser fallback: let CSS @media (prefers-color-scheme) handle it
        console.warn('[theme] Telegram not available; using system theme');
        return;
    }

    // Important for Android: mark app ready so Telegram applies colors properly
    try { tg.ready(); } catch (_) {}

    const scheme = tg.colorScheme || 'light';
    const vars = fromTelegram(tg.themeParams, scheme);
    applyVars(vars, scheme === 'dark');

    // Keep Telegram chrome in sync (Android)
    try {
        tg.setBackgroundColor(vars.bg);
        tg.setHeaderColor(scheme === 'dark' ? 'secondary_bg_color' : 'bg_color');
    } catch (_) {}

    tg.onEvent && tg.onEvent('themeChanged', () => {
        const s = tg.colorScheme || 'light';
        const v = fromTelegram(tg.themeParams, s);
        applyVars(v, s === 'dark');
        try {
            tg.setBackgroundColor(v.bg);
            tg.setHeaderColor(s === 'dark' ? 'secondary_bg_color' : 'bg_color');
        } catch (_) {}
    });

    // Optional: expand viewport
    try { tg.expand(); } catch (_) {}
}

document.addEventListener('DOMContentLoaded', initTheme);
