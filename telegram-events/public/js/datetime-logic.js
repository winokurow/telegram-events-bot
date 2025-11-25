// public/js/datetime-logic.js
// Centralized date/time UX + validation (no duplication with app.js)
// Rules:
// - Start (datetime-local) is required and prefilled with "now" (rounded to minutes).
// - End (date + time) is always visible and optional.
//   * If endTime is set but endDate is empty → error on endDate.
//   * If endDate is empty when user leaves/changes Start OR on submit → set endDate = Start's date.
//   * If End exists, ensure End >= Start (default end time = 23:59 when time not set).
// Exposes helpers on window.DateTimeLogic for app.js to build Date objects consistently.

(function () {
  if (window.__dtLogicInited) return;
  window.__dtLogicInited = true;

  // ---------- helpers ----------
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function toDateTimeLocalValue(d) {
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }
  function toDateValue(d) {
    return (
      d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
    );
  }
  function parseStart(val) {
    return val ? new Date(val) : null;
  }
  function buildEndDate(endDateVal, endTimeVal) {
    if (!endDateVal) return null; // no end set
    var parts = endDateVal.split("-"); // YYYY-MM-DD
    var y = parseInt(parts[0], 10),
      m = parseInt(parts[1], 10) - 1,
      d = parseInt(parts[2], 10);
    var hh = 23,
      mm = 59; // default if time not set
    if (endTimeVal) {
      var t = endTimeVal.split(":");
      hh = parseInt(t[0], 10);
      mm = parseInt(t[1], 10);
    }
    return new Date(y, m, d, hh, mm, 0, 0);
  }

  // expose for app.js (so it doesn't duplicate logic)
  window.DateTimeLogic = {
    parseStart: parseStart,
    buildEndDate: buildEndDate,
  };

  // ---------- main ----------
  function init() {
    var form = document.getElementById("addEventForm");
    var startI = document.getElementById("eventStart"); // <input type="datetime-local">
    var endD = document.getElementById("endDate"); // <input type="date">
    var endT = document.getElementById("endTime"); // <input type="time">

    if (!form || !startI || !endD || !endT) {
      console.warn("[datetime-logic] required elements not found");
      return;
    }

    // 1) Prefill Start with current time (rounded to minutes) if empty
    if (!startI.value) {
      var now = new Date();
      now.setSeconds(0, 0);
      startI.value = toDateTimeLocalValue(now);
    }

    // 2) If user leaves/changes Start and End date is empty → copy Start date
    function maybeCopyEndDateFromStart() {
      if (!endD.value) {
        var s = parseStart(startI.value);
        if (s) endD.value = toDateValue(s);
      }
    }
    startI.addEventListener("blur", maybeCopyEndDateFromStart);
    startI.addEventListener("change", maybeCopyEndDateFromStart);

    // 3) Submit-time validation (single place, no loops)
    form.addEventListener("submit", function (e) {
      // clear any previous custom messages set by this script
      startI.setCustomValidity("");
      endD.setCustomValidity("");
      endT.setCustomValidity("");

      // Start must be present
      if (!startI.value) {
        e.preventDefault();
        startI.setCustomValidity("Пожалуйста, укажите дату и время начала.");
        if (typeof form.reportValidity === "function") form.reportValidity();
        startI.focus();
        return;
      }

      // If endTime is set but endDate empty -> error on endDate
      if (endT.value && !endD.value) {
        e.preventDefault();
        endD.setCustomValidity(
          "Пожалуйста, укажите дату окончания (задано время).",
        );
        if (typeof form.reportValidity === "function") form.reportValidity();
        endD.focus();
        return;
      }

      // If endDate still empty -> copy from start (per requirement)
      if (!endD.value) {
        var sCopy = parseStart(startI.value);
        if (sCopy) endD.value = toDateValue(sCopy);
      }

      // If we have an end (date present; time optional → 23:59), ensure end >= start
      var startDt = parseStart(startI.value);
      var endDt = buildEndDate(endD.value, endT.value);
      if (startDt && endDt && endDt < startDt) {
        e.preventDefault();
        endD.setCustomValidity(
          "Дата/время окончания не может быть раньше начала.",
        );
        if (typeof form.reportValidity === "function") form.reportValidity();
        endD.focus();
        return;
      }
      // valid -> allow submit; app.js will read values and build payload
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
