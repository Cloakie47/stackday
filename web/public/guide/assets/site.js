/* Stackday docs: hash routing (one page shown at a time), sidebar state, "On this page",
   client-side search over page titles and headings, light and dark toggle, mobile menu.
   No libraries. Works from file:// and inside a sandboxed frame. */
(function () {
  "use strict";

  var pages = Array.prototype.slice.call(document.querySelectorAll("article.page"));
  if (!pages.length) return;
  var pageById = {};
  pages.forEach(function (p) { pageById[p.id] = p; });
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav-link"));
  var tocList = document.getElementById("toc-list");
  var tocBox = document.querySelector(".toc");
  var current = null;
  var spy = null;

  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) { return null; }
    return null;
  }

  /* ---------- Theme ---------- */
  var root = document.documentElement;
  var saved = store("stackday-docs-theme");
  if (saved === "light" || saved === "dark") root.setAttribute("data-theme", saved);
  function effectiveTheme() {
    var t = root.getAttribute("data-theme");
    if (t === "light" || t === "dark") return t;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  var themeBtn = document.getElementById("theme-btn");
  function labelTheme() {
    if (!themeBtn) return;
    var next = effectiveTheme() === "dark" ? "light" : "dark";
    themeBtn.setAttribute("aria-label", "Switch to " + next + " theme");
    themeBtn.setAttribute("title", "Switch to " + next + " theme");
  }
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = effectiveTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      store("stackday-docs-theme", next);
      labelTheme();
    });
    labelTheme();
  }

  /* ---------- Heading anchors and ids ---------- */
  function slug(text) {
    return text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }
  var headingIndex = {};
  pages.forEach(function (p) {
    p.querySelectorAll("h2, h3").forEach(function (h) {
      if (!h.id) {
        var base = p.id + "-" + slug(h.textContent);
        var id = base, n = 2;
        while (document.getElementById(id)) id = base + "-" + n++;
        h.id = id;
      }
      headingIndex[h.id] = p.id;
      var a = document.createElement("a");
      a.className = "heading-anchor";
      a.href = "#" + h.id;
      a.setAttribute("aria-label", "Link to this section");
      a.textContent = "#";
      h.appendChild(a);
    });
  });

  /* ---------- Pager ---------- */
  pages.forEach(function (p, i) {
    var prev = pages[i - 1], next = pages[i + 1];
    var nav = document.createElement("nav");
    nav.className = "pager";
    nav.setAttribute("aria-label", "Previous and next page");
    if (prev) nav.appendChild(pagerLink(prev, "Previous", "prev"));
    if (next) nav.appendChild(pagerLink(next, "Next", "next"));
    p.appendChild(nav);
  });
  function pagerLink(p, label, cls) {
    var a = document.createElement("a");
    a.href = "#" + p.id;
    a.className = cls;
    var s = document.createElement("small");
    s.textContent = label;
    var t = document.createElement("span");
    t.textContent = p.getAttribute("data-title");
    a.appendChild(s);
    a.appendChild(t);
    return a;
  }

  /* ---------- Diagram scroll hints ---------- */
  document.querySelectorAll(".diagram-frame").forEach(function (f) {
    var hint = document.createElement("p");
    hint.className = "scroll-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.textContent = "Swipe sideways to see the whole diagram.";
    f.parentNode.insertBefore(hint, f.nextSibling);
  });
  function markScrolling(page) {
    page.querySelectorAll(".diagram-frame").forEach(function (f) {
      f.classList.toggle("scrolls", f.scrollWidth > f.clientWidth + 2);
      if (f.classList.contains("scrolls")) f.setAttribute("tabindex", "0");
      else f.removeAttribute("tabindex");
    });
  }
  window.addEventListener("resize", function () { if (current) markScrolling(current); });

  /* ---------- Routing ---------- */
  function headingText(h) {
    var c = h.cloneNode(true);
    var a = c.querySelector(".heading-anchor");
    if (a) a.remove();
    return c.textContent.trim();
  }
  function buildToc(page) {
    if (!tocList) return;
    tocList.innerHTML = "";
    var hs = page.querySelectorAll("h2, h3");
    if (tocBox) tocBox.hidden = hs.length < 2;
    hs.forEach(function (h) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = headingText(h);
      a.className = "lvl-" + h.tagName.charAt(1);
      a.addEventListener("click", function (e) {
        e.preventDefault();
        scrollToEl(h);
      });
      li.appendChild(a);
      tocList.appendChild(li);
    });
    if (spy) spy.disconnect();
    if ("IntersectionObserver" in window) {
      var links = tocList.querySelectorAll("a");
      spy = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            links.forEach(function (l) { l.classList.toggle("active", l.getAttribute("href") === "#" + en.target.id); });
          }
        });
      }, { rootMargin: "-80px 0px -70% 0px" });
      hs.forEach(function (h) { spy.observe(h); });
    }
  }
  function scrollToEl(el) {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    if (el.tagName === "H2" || el.tagName === "H3") {
      el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
    }
  }
  function show(pageId, targetId, fromNav) {
    var page = pageById[pageId] || pages[0];
    if (current !== page) {
      pages.forEach(function (p) { p.hidden = p !== page; });
      navLinks.forEach(function (l) {
        if (l.getAttribute("href") === "#" + page.id) l.setAttribute("aria-current", "page");
        else l.removeAttribute("aria-current");
      });
      document.title = page.getAttribute("data-title") + " | Stackday Docs";
      buildToc(page);
      current = page;
      markScrolling(page);
    }
    closeNav();
    var target = targetId && document.getElementById(targetId);
    if (target && target !== page) {
      requestAnimationFrame(function () { scrollToEl(target); });
    } else if (fromNav) {
      window.scrollTo(0, 0);
      var h1 = page.querySelector("h1");
      if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
    }
  }
  function route(fromNav) {
    var id = decodeURIComponent((window.location.hash || "").slice(1));
    if (pageById[id]) show(id, null, fromNav);
    else if (headingIndex[id]) show(headingIndex[id], id, fromNav);
    else show(pages[0].id, null, false);
  }
  window.addEventListener("hashchange", function () { route(true); });
  route(false);

  /* ---------- Mobile menu ---------- */
  var menuBtn = document.getElementById("menu-btn");
  var scrim = null;
  function openNav() {
    document.body.classList.add("nav-open");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "true");
    scrim = document.createElement("div");
    scrim.className = "nav-scrim";
    scrim.addEventListener("click", closeNav);
    document.body.appendChild(scrim);
    var cur = document.querySelector('.nav-link[aria-current="page"]') || document.querySelector(".nav-link");
    if (cur) cur.focus();
  }
  function closeNav() {
    if (!document.body.classList.contains("nav-open")) return;
    document.body.classList.remove("nav-open");
    if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
    if (scrim) { scrim.remove(); scrim = null; }
  }
  if (menuBtn) {
    menuBtn.addEventListener("click", function () {
      if (document.body.classList.contains("nav-open")) { closeNav(); menuBtn.focus(); } else openNav();
    });
  }

  /* ---------- Search ---------- */
  var index = [];
  pages.forEach(function (p) {
    var section = p.getAttribute("data-section") || "";
    var title = p.getAttribute("data-title");
    var lead = p.querySelector(".lead");
    index.push({ id: p.id, label: title, where: section, text: (title + " " + (p.getAttribute("data-keywords") || "") + " " + (lead ? lead.textContent : "")).toLowerCase(), weight: 3 });
    p.querySelectorAll("h2, h3").forEach(function (h) {
      var t = headingText(h);
      index.push({ id: h.id, label: t, where: title, text: t.toLowerCase(), weight: h.tagName === "H2" ? 2 : 1 });
    });
  });

  var dialog = null, input = null, list = null, results = [], sel = 0, lastFocus = null;
  function escapeHtml(s) { return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function highlight(label, words) {
    var html = escapeHtml(label);
    words.forEach(function (w) {
      if (w.length < 2) return;
      var re = new RegExp("(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
      html = html.replace(re, "<mark>$1</mark>");
    });
    return html;
  }
  function search(q) {
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return index.filter(function (r) { return r.weight === 3; });
    return index
      .map(function (r) {
        var score = 0;
        for (var i = 0; i < words.length; i++) {
          var at = r.text.indexOf(words[i]);
          if (at < 0) return null;
          score += (at === 0 ? 3 : 1) + r.weight;
          if (r.label.toLowerCase().indexOf(words[i]) >= 0) score += 2;
        }
        return { r: r, score: score };
      })
      .filter(Boolean)
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, 12)
      .map(function (x) { return x.r; });
  }
  function render() {
    var q = input.value.trim();
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    results = search(q);
    sel = 0;
    list.innerHTML = "";
    if (!results.length) {
      var li = document.createElement("li");
      li.className = "search-empty";
      li.textContent = "No page or heading matches “" + q + "”. Try a word like borrow, gift, fee or vault.";
      list.appendChild(li);
      input.removeAttribute("aria-activedescendant");
      return;
    }
    results.forEach(function (r, i) {
      var li = document.createElement("li");
      li.setAttribute("role", "presentation");
      var a = document.createElement("a");
      a.href = "#" + r.id;
      a.id = "sr-" + i;
      a.setAttribute("role", "option");
      a.innerHTML = "<small>" + escapeHtml(r.where || "Page") + "</small><span>" + highlight(r.label, words) + "</span>";
      a.addEventListener("click", function () { closeSearch(false); });
      a.addEventListener("mousemove", function () { setSel(i); });
      li.appendChild(a);
      list.appendChild(li);
    });
    setSel(0);
  }
  function setSel(i) {
    var items = list.querySelectorAll("a");
    if (!items.length) return;
    sel = (i + items.length) % items.length;
    items.forEach(function (a, j) {
      a.classList.toggle("sel", j === sel);
      a.setAttribute("aria-selected", j === sel ? "true" : "false");
    });
    input.setAttribute("aria-activedescendant", items[sel].id);
    items[sel].scrollIntoView({ block: "nearest" });
  }
  function openSearch() {
    if (dialog) return;
    lastFocus = document.activeElement;
    dialog = document.createElement("div");
    dialog.className = "search-scrim";
    dialog.innerHTML =
      '<div class="search-panel" role="dialog" aria-modal="true" aria-label="Search the docs">' +
      '<div class="search-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>' +
      '<input id="search-input" type="search" placeholder="Search pages and headings" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="search-results" aria-autocomplete="list" aria-label="Search pages and headings">' +
      '<span class="kbd">Esc</span></div>' +
      '<ul class="search-results" id="search-results" role="listbox" aria-label="Results"></ul>' +
      '<div class="search-hint"><span><span class="kbd">↑</span> <span class="kbd">↓</span> to move</span><span><span class="kbd">Enter</span> to open</span></div>' +
      "</div>";
    document.body.appendChild(dialog);
    input = dialog.querySelector("input");
    list = dialog.querySelector(".search-results");
    dialog.addEventListener("mousedown", function (e) { if (e.target === dialog) closeSearch(true); });
    input.addEventListener("input", render);
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel(sel + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setSel(sel - 1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        var r = results[sel];
        if (r) { closeSearch(false); go(r.id); }
      } else if (e.key === "Escape") { e.preventDefault(); closeSearch(true); }
      else if (e.key === "Tab") { e.preventDefault(); }
    });
    render();
    input.focus();
  }
  function go(id) {
    if (("#" + id) === window.location.hash) route(true);
    else window.location.hash = id;
  }
  function closeSearch(restore) {
    if (!dialog) return;
    dialog.remove();
    dialog = null;
    if (restore && lastFocus && lastFocus.focus) lastFocus.focus();
  }
  var trigger = document.getElementById("search-btn");
  if (trigger) trigger.addEventListener("click", openSearch);
  document.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    var typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable);
    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openSearch(); }
    else if (e.key === "/" && !typing) { e.preventDefault(); openSearch(); }
    else if (e.key === "Escape" && document.body.classList.contains("nav-open")) { closeNav(); if (menuBtn) menuBtn.focus(); }
  });
})();
