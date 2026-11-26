/* Vietbowl Potsdamer Platz – booking widget.
   Floating button:  <script src="https://potsdamerplatz.vietbowl.de/widget.js" async></script>
   Inline on a page: <div data-vietbowl-booking></div>
                     <script src="https://potsdamerplatz.vietbowl.de/widget.js" data-mode="inline" async></script>
   Options (on the script tag): data-lang="de|en|vi", data-label="Text", data-position="right|left", data-src="web" */
(function () {
  var s = document.currentScript || document.querySelector('script[src*="widget.js"]');
  if (!s || window.__vbWidget) return; window.__vbWidget = 1;
  var base = new URL(s.src).origin;
  var lang = (s.dataset.lang || (document.documentElement.lang || "de")).slice(0, 2).toLowerCase();
  if (["de", "en", "vi"].indexOf(lang) < 0) lang = "de";
  var label = s.dataset.label || { de: "Tisch reservieren", en: "Book a table", vi: "Đặt bàn" }[lang];
  var url = base + "/?embed=1&src=" + encodeURIComponent(s.dataset.src || "web") + "&lang=" + lang;
  var ORANGE = "#F28C28";

  function frame(h) {
    var f = document.createElement("iframe");
    f.src = url; f.title = label; f.loading = "lazy"; f.allow = "clipboard-write";
    f.style.cssText = "width:100%;border:0;display:block;background:transparent;color-scheme:dark;height:" + h;
    return f;
  }

  if ((s.dataset.mode || "") === "inline") {
    var boxes = document.querySelectorAll(s.dataset.target || "[data-vietbowl-booking]");
    Array.prototype.forEach.call(boxes, function (box) {
      var f = frame("760px"); box.appendChild(f);
      window.addEventListener("message", function (e) {
        if (e.origin !== base || e.source !== f.contentWindow || !e.data) return;
        if (e.data.vietbowl === "height") f.style.height = e.data.h + "px";
        /* next booking step: bring the top of the frame back into view (below a sticky site header) */
        if (e.data.vietbowl === "top") {
          var r = f.getBoundingClientRect();
          if (r.top < 70 || r.top > window.innerHeight * 0.4) window.scrollTo({ top: Math.max(0, r.top + window.pageYOffset - 100), behavior: "smooth" });
        }
      });
    });
    return;
  }

  var css = document.createElement("style");
  css.textContent =
    ".vbw-btn{position:fixed;bottom:20px;" + (s.dataset.position === "left" ? "left" : "right") + ":20px;z-index:2147483000;display:inline-flex;align-items:center;gap:10px;padding:14px 22px;border:0;border-radius:999px;background:linear-gradient(180deg,#FFB547," + ORANGE + ");color:#1b1006;font:700 16px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.35);cursor:pointer}" +
    ".vbw-btn:hover{filter:brightness(1.06)}.vbw-btn:focus-visible{outline:3px solid #fff;outline-offset:3px}.vbw-btn svg{width:20px;height:20px}" +
    ".vbw-ov{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px}" +
    ".vbw-box{position:relative;width:100%;max-width:640px;height:min(860px,92vh);border-radius:22px;overflow:hidden;background:#0b0805;box-shadow:0 24px 60px rgba(0,0,0,.6);border:1px solid rgba(242,140,40,.5)}" +
    ".vbw-x{position:absolute;top:10px;right:10px;z-index:2;width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(20,14,8,.9);color:#fff;font:400 24px/1 system-ui,sans-serif;cursor:pointer}" +
    "@media (max-width:560px){.vbw-ov{padding:0}.vbw-box{max-width:none;height:100%;border-radius:0;border:0}.vbw-btn{bottom:14px;padding:13px 18px}}";
  document.head.appendChild(css);

  var btn = document.createElement("button");
  btn.type = "button"; btn.className = "vbw-btn";
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span></span>';
  btn.lastChild.textContent = label;
  var ov = null, lastFocus = null;
  function close() { if (!ov) return; ov.remove(); ov = null; document.documentElement.style.overflow = ""; if (lastFocus) lastFocus.focus(); }
  btn.addEventListener("click", function () {
    lastFocus = document.activeElement;
    ov = document.createElement("div"); ov.className = "vbw-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", label);
    var box = document.createElement("div"); box.className = "vbw-box";
    var x = document.createElement("button"); x.type = "button"; x.className = "vbw-x"; x.setAttribute("aria-label", { de: "Schließen", en: "Close", vi: "Đóng" }[lang]); x.textContent = "×";
    x.addEventListener("click", close);
    var f = frame("100%"); f.style.overflow = "auto"; f.loading = "eager";
    box.appendChild(x); box.appendChild(f); ov.appendChild(box);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov); document.documentElement.style.overflow = "hidden"; x.focus();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
  (document.body ? Promise.resolve() : new Promise(function (r) { document.addEventListener("DOMContentLoaded", r); })).then(function () { document.body.appendChild(btn); });
})();
