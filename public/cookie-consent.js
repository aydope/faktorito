/* Cookie notice. Faktorito only sets the session cookie that keeps you signed in,
   so this is an acknowledgement, remembered in the browser. */
(function () {
  var KEY = "fx_cookie_consent";
  function read() {
    try {
      if (localStorage.getItem(KEY)) return true;
    } catch (e) {
      /* storage blocked */
    }
    return /(?:^|;\s*)fx_cc=1/.test(document.cookie);
  }
  function remember() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ v: 1, at: new Date().toISOString() }),
      );
    } catch (e) {
      /* fall back to a cookie */
    }
    document.cookie =
      "fx_cc=1; max-age=" +
      60 * 60 * 24 * 180 +
      "; path=/; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  }
  if (read()) return;

  function show() {
    var css = document.createElement("style");
    css.textContent =
      "#fx-cookie{position:fixed;z-index:2147483000;right:16px;left:16px;bottom:16px;max-width:560px;margin:0 auto;display:flex;gap:14px;align-items:center;flex-wrap:wrap;" +
      "background:#ffffff;color:#1f2937;border:1px solid #d1d5db;border-radius:10px;padding:14px 16px;box-shadow:0 6px 24px rgba(0,0,0,.18);" +
      "font:13px/1.9 Sahel,Vazirmatn,Tahoma,sans-serif;direction:rtl;text-align:right}" +
      "#fx-cookie p{margin:0;flex:1 1 240px}#fx-cookie a{color:#1d4ed8;text-decoration:underline}" +
      "#fx-cookie button{border:0;border-radius:8px;background:#111827;color:#fff;padding:8px 20px;font:inherit;font-weight:700;cursor:pointer}" +
      "#fx-cookie button:focus-visible{outline:2px solid #1d4ed8;outline-offset:2px}@media print{#fx-cookie{display:none}}";
    document.head.appendChild(css);

    var box = document.createElement("div");
    box.id = "fx-cookie";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "اطلاعیه کوکی");

    var p = document.createElement("p");
    p.appendChild(
      document.createTextNode(
        "این سایت فقط از کوکی‌های ضروری (برای ورود به حساب) استفاده می‌کند و از کوکی تبلیغاتی یا ردیابی استفاده نمی‌کند. جزئیات در ",
      ),
    );
    var a = document.createElement("a");
    a.href = "/privacy";
    a.textContent = "سیاست حریم خصوصی";
    p.appendChild(a);
    p.appendChild(document.createTextNode(" آمده است."));

    var b = document.createElement("button");
    b.type = "button";
    b.textContent = "قبول";
    b.addEventListener("click", function () {
      remember();
      box.parentNode && box.parentNode.removeChild(box);
    });

    box.appendChild(p);
    box.appendChild(b);
    document.body.appendChild(box);
  }
  if (document.body) show();
  else document.addEventListener("DOMContentLoaded", show);
})();
