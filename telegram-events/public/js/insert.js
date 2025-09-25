document.addEventListener('DOMContentLoaded', () => {
    // --- guards -------------------------------------------------------------
    if (typeof firebase === 'undefined') {
        console.error('🔥 firebase SDK not loaded');
        return;
    }
    if (typeof db === 'undefined') {
        console.error('🔥 db is undefined! Check firebase-init.js');
        return;
    }
    if (typeof storage === 'undefined') {
        console.error('🔥 storage is undefined! Check firebase-init.js');
        return;
    }
    if (typeof window.DateTimeLogic === 'undefined') {
        console.error('⚠️ DateTimeLogic not found. Load /js/datetime-logic.js before app.js');
        // we can still proceed, but date building will fallback below
    }

    // --- fallback UI helpers (in case you didn't include a separate error-ui.js) ---
    function showErrorBanner(message) {
        var el = document.getElementById('formError');
        if (el) {
            el.textContent = message;
            el.style.display = 'block';
        } else {
            alert(message);
        }
        try {
            if (window.Telegram && Telegram.WebApp) {
                Telegram.WebApp.showAlert(message);
            }
        } catch (_e) {}
    }
    function hideErrorBanner() {
        var el = document.getElementById('formError');
        if (el) {
            el.textContent = '';
            el.style.display = 'none';
        }
    }
    function setSubmitting(isOn) {
        var btn = document.querySelector('#addEventForm button[type="submit"]');
        if (btn) {
            btn.disabled = isOn;
            btn.textContent = isOn ? 'Отправка…' : 'Добавить';
        }
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
        } catch (_e) {}
    }
    function humanizeError(err) {
        if (!err) return 'Неизвестная ошибка.';
        if (typeof err === 'string') return err;
        if (err.message) return err.message;
        try { return JSON.stringify(err); } catch (_e) { return String(err); }
    }

    // --- elements -----------------------------------------------------------
    var addForm            = document.getElementById('addEventForm');
    if (!addForm) return;

    var nameInput          = document.getElementById('eventName');
    var categorySelect     = document.getElementById('category');
    var tagsInput          = document.getElementById('eventTags');
    var descInput          = document.getElementById('eventDescription');
    var imgInput           = document.getElementById('eventImage');
    var startInput         = document.getElementById('eventStart'); // datetime-local
    var endDateInput       = document.getElementById('endDate');    // date
    var endTimeInput       = document.getElementById('endTime');    // time
    var placeInput         = document.getElementById('eventPlace');
    var priceInput         = document.getElementById('eventPrice');
    var linkInput          = document.getElementById('eventLink');
    var contactInput       = document.getElementById('eventContact');
    var skipTelegramInput = document.getElementById('skipTelegram');
    // --- submit handler -----------------------------------------------------
    addForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        hideErrorBanner();
        setSubmitting(true);

        try {
            // 1) Collect fields
            var name      = (nameInput.value || '').trim();
            var category  = (categorySelect.value || '').trim();
            var tagsRaw   = (tagsInput.value || '').trim();
            var startStr  = (startInput.value || '').trim(); // "YYYY-MM-DDThh:mm"
            var endDateV  = (endDateInput && endDateInput.value) ? endDateInput.value : '';
            var endTimeV  = (endTimeInput && endTimeInput.value) ? endTimeInput.value : '';
            var description = descInput.value || '';
            var place     = (placeInput.value || '').trim();
            var price     = (priceInput.value || '').trim();
            var link      = (linkInput.value || '').trim();
            var contact   = (contactInput.value || '').trim();

            // 2) Basic required checks (field-level validation & date rules are enforced by datetime-logic.js)
            if (!name || !category || !startStr || !place) {
                setSubmitting(false);
                showErrorBanner('Пожалуйста, заполните обязательные поля: Название, Категория, Время начала, Место.');
                return;
            }

            // 3) Build dates using DateTimeLogic helpers
            var startDateTime, endDateTime = null;

            if (window.DateTimeLogic && typeof DateTimeLogic.parseStart === 'function') {
                startDateTime = DateTimeLogic.parseStart(startStr);
            } else {
                // fallback: parse directly
                startDateTime = new Date(startStr);
            }

            if (window.DateTimeLogic && typeof DateTimeLogic.buildEndDate === 'function') {
                endDateTime = DateTimeLogic.buildEndDate(endDateV, endTimeV); // null if no end date
            } else {
                if (endDateV) {
                    var hh = 23, mm = 59;
                    if (endTimeV) {
                        var tt = endTimeV.split(':');
                        hh = parseInt(tt[0],10); mm = parseInt(tt[1],10);
                    }
                    var p = endDateV.split('-'); // YYYY-MM-DD
                    endDateTime = new Date(parseInt(p[0],10), parseInt(p[1],10)-1, parseInt(p[2],10), hh, mm, 0, 0);
                }
            }

            // 4) Tags array
            var tagsArray = tagsRaw ? tagsRaw.split(',').map(function (t) { return t.trim(); }).filter(Boolean) : [];

            // 5) Create doc ref first (to use its id for image path)
            var eventRef = db.collection('events').doc();

            // 6) Optional image upload (align with your Storage rules)
            const postToTelegram = !(skipTelegramInput && skipTelegramInput.checked);

            var newEventData = {
                name: name,
                category: category,
                tags: tagsArray,
                description: description,
                place: place,
                price: price,
                link: link,
                contact: contact,
                startDateTime: firebase.firestore.Timestamp.fromDate(startDateTime),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                postToTelegram
            };
            if (endDateTime) {
                newEventData.endDateTime = firebase.firestore.Timestamp.fromDate(endDateTime);
            }

            if (imgInput && imgInput.files && imgInput.files.length > 0) {
                var file = imgInput.files[0];
                var isImage = /^image\//.test(file.type);
                var isSmall = file.size < 5 * 1024 * 1024; // 5MB
                if (!isImage || !isSmall) {
                    setSubmitting(false);
                    showErrorBanner('Картинка должна быть формата image/* и меньше 5 МБ.');
                    return;
                }

                var storageRef = storage.ref('eventImages/' + eventRef.id + '/' + file.name);
                try {
                    var snapshot = await storageRef.put(file);
                    var downloadURL = await snapshot.ref.getDownloadURL();
                    newEventData.imageURL = downloadURL;
                } catch (upErr) {
                    console.error('Upload error:', upErr);
                    setSubmitting(false);
                    showErrorBanner('Не удалось загрузить изображение. Проверьте размер/тип файла и попробуйте снова.');
                    return;
                }
            }



            // 7) Write to Firestore
            await eventRef.set(newEventData);

            // 8) Success UI
            try { if (window.Telegram && Telegram.WebApp) Telegram.WebApp.showAlert('Событие добавлено!'); } catch (_e) {}
            addForm.reset();

            // Refill start with "now" after reset to keep UX consistent
            try {
                var now = new Date(); now.setSeconds(0,0);
                if (startInput) {
                    var y = now.getFullYear();
                    var m = (now.getMonth()+1 < 10 ? '0' : '') + (now.getMonth()+1);
                    var d = (now.getDate() < 10 ? '0' : '') + now.getDate();
                    var hh = (now.getHours() < 10 ? '0' : '') + now.getHours();
                    var mm2 = (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();
                    startInput.value = y + '-' + m + '-' + d + 'T' + hh + ':' + mm2;
                }
            } catch (_e) {}

            // (If posting to Telegram is triggered by a backend onCreate, nothing more to do here.)
        } catch (err) {
            console.error('Submit error:', err);
            showErrorBanner(humanizeError(err) || 'Не удалось отправить данные.');
        } finally {
            setSubmitting(false);
        }
    });
});
