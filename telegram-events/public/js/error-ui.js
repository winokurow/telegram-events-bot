function showErrorBanner(message) {
    const el = document.getElementById('formError');
    if (!el) return;
    el.textContent = message;
    el.style.display = 'block';

    // Дополнительно — показать внутри Telegram "алерт"
    try {
        if (window.Telegram && Telegram.WebApp) {
            Telegram.WebApp.showAlert(message);
        }
    } catch (_) {}
}

function hideErrorBanner() {
    const el = document.getElementById('formError');
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
}

function setSubmitting(isOn) {
    const btn = document.querySelector('#addEventForm button[type="submit"]');
    if (btn) {
        btn.disabled = isOn;
        btn.textContent = isOn ? 'Отправка…' : 'Добавить';
    }
    // Telegram MainButton (если используешь его)
    try {
        if (window.Telegram && Telegram.WebApp && Telegram.WebApp.MainButton) {
            if (isOn) {
                Telegram.WebApp.MainButton.setText('Отправка…');
                Telegram.WebApp.MainButton.showProgress();
                Telegram.WebApp.MainButton.disable();
            } else {
                Telegram.WebApp.MainButton.hideProgress();
                Telegram.WebApp.MainButton.setText('Добавить');
                Telegram.WebApp.MainButton.enable();
            }
        }
    } catch (_) {}
}

// Преобразовать ошибку в человекочитаемый текст
function humanizeError(err) {
    if (!err) return 'Неизвестная ошибка.';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    try { return JSON.stringify(err); } catch { return String(err); }
}
