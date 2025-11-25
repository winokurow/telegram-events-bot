// public/js/validation-ru.js (v5)
(function () {
  if (window.__validationRU_inited) return;
  window.__validationRU_inited = true;

  function ruMessage(el) {
    var v = el.validity;
    var label = el.dataset.label || el.name || el.id || "Поле";
    if (v.valueMissing) return "Пожалуйста, заполните поле «" + label + "».";
    if (v.typeMismatch && el.type === "email")
      return "Введите корректный e-mail в поле «" + label + "».";
    if (v.typeMismatch && el.type === "url")
      return "Введите корректный URL в поле «" + label + "».";
    if (v.patternMismatch) return "Неверный формат в поле «" + label + "».";
    if (v.tooShort)
      return (
        "Слишком короткое значение в поле «" +
        label +
        "». Минимум: " +
        el.minLength +
        "."
      );
    if (v.tooLong)
      return (
        "Слишком длинное значение в поле «" +
        label +
        "». Максимум: " +
        el.maxLength +
        "."
      );
    if (v.rangeUnderflow)
      return "Значение в поле «" + label + "» должно быть ≥ " + el.min + ".";
    if (v.rangeOverflow)
      return "Значение в поле «" + label + "» должно быть ≤ " + el.max + ".";
    if (v.stepMismatch)
      return "Недопустимый шаг значения в поле «" + label + "».";
    return "";
  }

  function setFieldValidity(el) {
    // Сначала очистим кастомное сообщение
    el.setCustomValidity("");
    // Если всё ещё невалидно — поставим свой текст
    if (!el.checkValidity()) {
      el.setCustomValidity(ruMessage(el));
      return false;
    }
    return true;
  }

  function validateForm(form) {
    var firstInvalid = null;
    Array.prototype.forEach.call(form.elements, function (el) {
      if (
        !(
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement
        )
      )
        return;
      var ok = setFieldValidity(el);
      if (!ok && !firstInvalid) firstInvalid = el;
    });
    return firstInvalid;
  }

  function init(formId) {
    var form = document.getElementById(formId || "addEventForm");
    if (!form) {
      console.warn(
        "[validation-ru] Форма не найдена: id=" + (formId || "addEventForm"),
      );
      return;
    }

    // На ввод/изменение валидируем конкретное поле (без reportValidity)
    form.addEventListener("input", function (e) {
      var el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
        setFieldValidity(el);
    });
    form.addEventListener("change", function (e) {
      var el = e.target;
      if (el instanceof HTMLSelectElement) setFieldValidity(el);
    });
    // На blur — тоже локальная проверка
    form.addEventListener(
      "blur",
      function (e) {
        var el = e.target;
        if (el && typeof el.checkValidity === "function") setFieldValidity(el);
      },
      true,
    );

    // Единственное место, где вызываем reportValidity()
    form.addEventListener("submit", function (e) {
      var firstInvalid = validateForm(form);
      if (firstInvalid) {
        e.preventDefault();
        if (typeof form.reportValidity === "function") {
          form.reportValidity(); // показать подсказки
        }
        firstInvalid.focus();
      }
      // Если всё ок — продолжается твоя логика submit (Firestore и т.п.)
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      init("addEventForm");
    });
  } else {
    init("addEventForm");
  }
})();
