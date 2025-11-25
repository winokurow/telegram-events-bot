// public/js/search.js
// Search page logic with interval-overlap filtering.
// Shows an event if [eventStart, eventEndOrStart] overlaps [searchFrom 00:00, searchTo 23:59].

(function () {
  // -------- small helpers --------
  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    if (attrs)
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === "class") n.className = v;
        else n.setAttribute(k, v);
      });
    for (const c of children) n.append(c);
    return n;
  }

  function showError(msg) {
    const b = document.getElementById("formError");
    if (!b) return alert(msg);
    b.textContent = msg;
    b.style.display = "block";
    try {
      Telegram.WebApp.showAlert(msg);
    } catch (_) {}
  }
  function hideError() {
    const b = document.getElementById("formError");
    if (!b) return;
    b.style.display = "none";
    b.textContent = "";
  }

  function formatDateRange(startTs, endTs) {
    const optsDate = { year: "numeric", month: "2-digit", day: "2-digit" };
    const optsTime = { hour: "2-digit", minute: "2-digit" };
    const s = startTs ? startTs.toDate() : null;
    const e = endTs ? endTs.toDate() : null;
    if (!s && !e) return "";

    if (s && !e) {
      return `${s.toLocaleDateString("de-DE", optsDate)} ${s.toLocaleTimeString("de-DE", optsTime)}`;
    }
    const sameDay =
      s &&
      e &&
      s.getFullYear() === e.getFullYear() &&
      s.getMonth() === e.getMonth() &&
      s.getDate() === e.getDate();

    if (sameDay) {
      return `${s.toLocaleDateString("de-DE", optsDate)} ${s.toLocaleTimeString("de-DE", optsTime)} – ${e.toLocaleTimeString("de-DE", optsTime)}`;
    }
    return `${s.toLocaleDateString("de-DE", optsDate)} ${s.toLocaleTimeString("de-DE", optsTime)} → ${e.toLocaleDateString("de-DE", optsDate)} ${e.toLocaleTimeString("de-DE", optsTime)}`;
  }

  // interval overlap: true if [eStart, eEndOrStart] overlaps [rStart, rEnd]
  function overlaps(eventStart, eventEnd, rangeStart, rangeEnd) {
    if (!rangeStart && !rangeEnd) return true; // no range -> accept all
    const eStart = eventStart;
    const eEnd = eventEnd || eventStart; // instant if no end
    const startsBeforeRangeEnds = !rangeEnd || eStart <= rangeEnd;
    const endsAfterRangeStarts = !rangeStart || eEnd >= rangeStart;
    return startsBeforeRangeEnds && endsAfterRangeStarts;
  }

  function populateCategories() {
    const sel = document.getElementById("searchCategory");
    if (!sel) return;
    sel.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Все категории";
    placeholder.selected = true;
    sel.appendChild(placeholder);

    const dict = window.categories || {};
    Object.entries(dict).forEach(([id, ru]) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = ru;
      sel.appendChild(opt);
    });
  }

  function renderResults(list) {
    const wrap = document.getElementById("resultsContainer");
    wrap.innerHTML = "";

    if (!list.length) {
      wrap.append(el("div", null, "Ничего не найдено."));
      return;
    }

    list.forEach((doc) => {
      const d = doc.data();
      const title = d.name || "(без названия)";
      const when = formatDateRange(d.startDateTime, d.endDateTime);
      const place = d.place || "";
      const price = d.price || "";
      const desc = d.description || "";
      const tags = Array.isArray(d.tags) ? d.tags : [];
      const img = d.imageURL || null;

      const card = el("div", { class: "event-card" });
      if (img) {
        const im = el("img", { class: "event-thumb", src: img, alt: title });
        card.appendChild(im);
      }
      card.appendChild(el("h3", null, title));
      if (when) card.appendChild(el("div", null, when));
      if (place) card.appendChild(el("div", null, `Место: ${place}`));
      if (price) card.appendChild(el("div", null, `Цена: ${price}`));
      if (desc) card.appendChild(el("p", null, desc));

      if (tags.length) {
        const tagsWrap = el("div", null);
        tags.forEach((t) =>
          tagsWrap.appendChild(el("span", { class: "tag" }, t)),
        );
        card.appendChild(tagsWrap);
      }

      wrap.appendChild(card);
    });
  }

  async function runSearch(e) {
    e && e.preventDefault();
    hideError();

    if (typeof db === "undefined") {
      showError("Firebase не инициализирован. Проверьте firebase-init.js");
      return;
    }

    const kw = (document.getElementById("searchKeyword").value || "")
      .trim()
      .toLowerCase();
    const cat = (document.getElementById("searchCategory").value || "").trim();
    const tagsIn = (document.getElementById("searchTags").value || "").trim();
    const dateFrom = (document.getElementById("dateFrom").value || "").trim(); // YYYY-MM-DD
    const dateTo = (document.getElementById("dateTo").value || "").trim(); // YYYY-MM-DD
    const placeQ = (document.getElementById("searchPlace").value || "")
      .trim()
      .toLowerCase();

    // Build search interval [searchStart, searchEnd]
    const searchStart = dateFrom ? new Date(dateFrom + "T00:00") : null;
    const searchEnd = dateTo ? new Date(dateTo + "T23:59") : null;

    try {
      // MVP: pre-filter on category if set, else order by startDateTime
      let q = db
        .collection("events")
        .orderBy("startDateTime", "desc")
        .limit(200);
      if (cat) {
        q = db
          .collection("events")
          .where("category", "==", cat)
          .orderBy("startDateTime", "desc")
          .limit(200);
      }

      const snap = await q.get(q);

      const tagsArr = tagsIn
        ? tagsIn
            .split(",")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
        : [];

      const rows = [];
      snap.forEach((doc) => {
        console.log(doc.data());
        const d = doc.data();

        // 1) Interval filter — keep only overlapping events
        const s = d.startDateTime ? d.startDateTime.toDate() : null;
        const e = d.endDateTime ? d.endDateTime.toDate() : null;
        console.log(s);
        console.log(e);
        if (s && !overlaps(s, e, searchStart, searchEnd)) return;

        // 2) Keyword in name/description (case-insensitive)
        if (kw) {
          const hay = (
            (d.name || "") +
            " " +
            (d.description || "")
          ).toLowerCase();
          if (!hay.includes(kw)) return;
        }

        // 3) Place contains (case-insensitive)
        if (placeQ) {
          const p = (d.place || "").toLowerCase();
          if (!p.includes(placeQ)) return;
        }

        // 4) Tags: require every entered tag to be present (AND)
        if (tagsArr.length) {
          const docTags = Array.isArray(d.tags)
            ? d.tags.map((x) => (x || "").toLowerCase())
            : [];
          const ok = tagsArr.every((t) => docTags.includes(t));
          if (!ok) return;
        }

        rows.push(doc);
      });

      renderResults(rows);
    } catch (err) {
      console.error("Search error:", err);
      showError("Ошибка при поиске: " + (err.message || "неизвестная ошибка"));
    }
  }

  // init
  document.addEventListener("DOMContentLoaded", () => {
    populateCategories();
    const form = document.getElementById("searchForm");
    if (form) form.addEventListener("submit", runSearch);
  });
})();
