/* Live layer (Socket.IO). Loaded on every logged-in page after /socket.io/socket.io.js.
 *
 *  1. Notification bell: a notification becomes READ when it was actually seen - the
 *     panel is open, the tab is visible and the row has been on screen for a moment.
 *     No "mark all" press needed. Read state is synced to the user's other tabs.
 *  2. Live pages: the server says "invoices / members / me ... changed" and the open
 *     page refreshes just the affected region (or runs the handler the page registered).
 *  3. A small dot on the bell shows whether the live connection is up; after a drop the
 *     page resyncs everything it may have missed.
 *
 * All text is inserted with textContent, never HTML. */
(() => {
  "use strict";

  const READ_AFTER_MS = 1200; // how long a row must stay visible to count as read
  const btn = document.getElementById("notifBtn");
  const badge = document.getElementById("notifBadge");
  const panel = document.getElementById("notifPanel");
  const list = document.getElementById("notifList");
  const dot = document.getElementById("liveDot");
  const hasBell = !!(btn && panel && list);

  const api = (url, method = "GET", body) =>
    fetch(url, {
      method,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      credentials: "same-origin",
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());

  const pageVisible = () =>
    document.visibilityState === "visible" &&
    (typeof document.hasFocus !== "function" || document.hasFocus());

  /* ------------------------------------------------------------------ bell */
  let unread = 0;
  const bell = {};

  if (hasBell) {
    const ICONS = {
      invoice: "bi-receipt",
      payment: "bi-check-circle",
      membership: "bi-hourglass-split",
      system: "bi-bell",
    };
    const timers = new Map(); // id -> timeout while a row is being "read"
    const pending = new Set(); // ids waiting to be sent
    let flushTimer = null;

    const safeUrl = (u) =>
      typeof u === "string" && /^\/(?!\/)/.test(u) ? u : "";
    const isOpen = () => panel.classList.contains("active");

    const setUnread = (n) => {
      unread = Math.max(0, Number(n) || 0);
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.style.display = unread ? "flex" : "none";
      btn.setAttribute(
        "aria-label",
        unread ? `اعلان‌ها، ${unread} خوانده‌نشده` : "اعلان‌ها",
      );
    };

    const timeAgo = (iso) => {
      const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 60) return "همین الان";
      if (s < 3600) return Math.floor(s / 60) + " دقیقه پیش";
      if (s < 86400) return Math.floor(s / 3600) + " ساعت پیش";
      return Math.floor(s / 86400) + " روز پیش";
    };

    const markRowRead = (row) => {
      row.classList.remove("unread");
      observer?.unobserve(row);
    };

    // ---- sending read receipts (batched)
    const flush = async () => {
      flushTimer = null;
      const ids = [...pending];
      pending.clear();
      if (!ids.length) return;
      try {
        const res = await api("/notifications/read", "POST", {
          ids: ids.slice(0, 50),
        });
        if (res && res.success) {
          ids.forEach((id) => {
            const row = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
            if (row) markRowRead(row);
          });
          setUnread(res.unread);
        }
      } catch {
        ids.forEach((id) => pending.add(id)); // try again with the next batch
        flushTimer = setTimeout(flush, 4000);
      }
    };
    const queueRead = (id) => {
      pending.add(id);
      if (!flushTimer) flushTimer = setTimeout(flush, 350);
    };

    // ---- "was it really seen?": row visible inside the open panel for READ_AFTER_MS
    const observer =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              entries.forEach((en) => {
                const id = en.target.dataset.id;
                if (!id || !en.target.classList.contains("unread")) return;
                if (en.isIntersecting && isOpen() && pageVisible()) {
                  if (!timers.has(id)) {
                    timers.set(
                      id,
                      setTimeout(() => {
                        timers.delete(id);
                        if (isOpen() && pageVisible()) queueRead(id);
                      }, READ_AFTER_MS),
                    );
                  }
                } else {
                  clearTimeout(timers.get(id));
                  timers.delete(id);
                }
              });
            },
            { root: list, threshold: 0.6 },
          )
        : null;

    const watchUnreadRows = () => {
      if (!isOpen() || !pageVisible()) return;
      const rows = list.querySelectorAll(".notif-item.unread");
      if (observer) {
        rows.forEach((r) => {
          observer.unobserve(r);
          observer.observe(r);
        }); // observe() reports the current state again
      } else {
        // very old browsers: everything in an open panel counts as seen after a moment
        rows.forEach((r) => {
          if (!timers.has(r.dataset.id))
            timers.set(
              r.dataset.id,
              setTimeout(() => {
                timers.delete(r.dataset.id);
                queueRead(r.dataset.id);
              }, READ_AFTER_MS),
            );
        });
      }
    };
    const stopWatching = () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };

    const render = (n, { prepend = false } = {}) => {
      const empty = list.querySelector("[data-empty]");
      if (empty) empty.remove();
      if (list.querySelector(`[data-id="${CSS.escape(n.id)}"]`)) return; // already shown (e.g. after a resync)

      const row = document.createElement("a");
      row.className = "notif-item" + (n.readAt ? "" : " unread");
      row.dataset.id = n.id;
      row.href = safeUrl(n.url) || "#";

      const icon = document.createElement("i");
      icon.className = "bi " + (ICONS[n.type] || ICONS.system);
      const box = document.createElement("div");
      box.className = "notif-main";
      const title = document.createElement("div");
      title.className = "notif-title";
      title.textContent = n.title;
      const body = document.createElement("div");
      body.className = "notif-body";
      body.textContent = n.body || "";
      const time = document.createElement("div");
      time.className = "notif-time";
      time.textContent = timeAgo(n.createdAt);
      time.dataset.at = n.createdAt;
      box.append(title, body, time);
      const mark = document.createElement("span");
      mark.className = "notif-dot";
      mark.setAttribute("aria-hidden", "true");
      row.append(icon, box, mark);

      row.addEventListener("click", (e) => {
        if (row.classList.contains("unread")) queueRead(n.id); // opened = read, right now
        if (row.getAttribute("href") === "#") e.preventDefault();
      });

      prepend ? list.prepend(row) : list.append(row);
      while (list.children.length > 30) list.lastElementChild.remove();
      if (isOpen() && !n.readAt) watchUnreadRows();
    };

    const showEmpty = () => {
      const d = document.createElement("div");
      d.dataset.empty = "1";
      d.className = "notif-empty";
      d.textContent = "اعلان جدیدی ندارید";
      list.append(d);
    };

    const load = async () => {
      try {
        const data = await api("/notifications");
        if (!data || !data.items) return;
        list.replaceChildren();
        data.items.length ? data.items.forEach((n) => render(n)) : showEmpty();
        setUnread(data.unread);
        watchUnreadRows();
      } catch {
        /* the bell simply keeps what it has */
      }
    };

    const open = () => {
      panel.classList.add("active");
      btn.setAttribute("aria-expanded", "true");
      list.querySelectorAll(".notif-time[data-at]").forEach((t) => {
        t.textContent = timeAgo(t.dataset.at);
      });
      watchUnreadRows();
    };
    const close = () => {
      panel.classList.remove("active");
      btn.setAttribute("aria-expanded", "false");
      stopWatching();
    };

    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      isOpen() ? close() : open();
    });
    document.addEventListener("click", (e) => {
      if (isOpen() && !panel.contains(e.target) && !btn.contains(e.target))
        close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) {
        close();
        btn.focus();
      }
    });
    // reading is paused while the tab is hidden and resumes when it is shown again
    document.addEventListener("visibilitychange", () => {
      pageVisible() ? watchUnreadRows() : stopWatching();
    });
    window.addEventListener("blur", stopWatching);
    window.addEventListener("focus", watchUnreadRows);

    // the button stays as a shortcut, reading is automatic anyway
    document
      .getElementById("notifReadAll")
      ?.addEventListener("click", async () => {
        try {
          const res = await api("/notifications/read", "POST");
          if (res && res.success) {
            list.querySelectorAll(".notif-item.unread").forEach(markRowRead);
            setUnread(res.unread);
          }
        } catch {
          /* ignore */
        }
      });

    // another tab / device read some notifications
    bell.syncRead = (ids, count) => {
      (
        ids ||
        [...list.querySelectorAll(".notif-item.unread")].map(
          (r) => r.dataset.id,
        )
      ).forEach((id) => {
        const row = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (row) markRowRead(row);
        pending.delete(id);
      });
      setUnread(count);
    };
    bell.render = render;
    bell.load = load;
    bell.unread = () => unread;
    bell.setUnread = setUnread;
    window.__notif = bell;
    load();
  }

  /* ------------------------------------------------------------ live pages */
  // Pages register `window.fxLiveHandlers.<topic> = fn`; otherwise any element with
  // data-live="topic ..." + data-live-id="x" is refreshed from a fresh copy of the page.
  const queued = new Set();
  let refreshTimer = null;
  let retries = 0;

  const busy = () =>
    !!document.querySelector(
      ".modal-overlay.active, .modal-overlay.show, dialog[open]",
    ) ||
    (document.activeElement &&
      /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) &&
      !!document.activeElement.closest("[data-live]"));

  const swapRegions = async (regions) => {
    const res = await fetch(location.pathname + location.search, {
      headers: { "X-Requested-With": "fxlive", Accept: "text/html" },
      credentials: "same-origin",
    });
    if (!res.ok || res.redirected) return; // signed out or moved: leave the page alone
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    regions.forEach((el) => {
      const fresh = doc.querySelector(
        `[data-live-id="${CSS.escape(el.dataset.liveId || "")}"]`,
      );
      if (!fresh || fresh.innerHTML === el.innerHTML) return;
      el.innerHTML = fresh.innerHTML;
      el.classList.remove("live-flash");
      void el.offsetWidth; // restart the animation
      el.classList.add("live-flash");
    });
  };

  const runRefresh = async () => {
    refreshTimer = null;
    if (!queued.size) return;
    if (busy() && retries < 20) {
      // never yank the page from under someone typing or in a dialog
      retries++;
      refreshTimer = setTimeout(runRefresh, 1500);
      return;
    }
    retries = 0;
    const topics = [...queued];
    queued.clear();

    const handlers = window.fxLiveHandlers || {};
    const regions = new Set();
    for (const topic of topics) {
      if (typeof handlers[topic] === "function") {
        try {
          handlers[topic]();
        } catch {
          /* a page handler must not break the others */
        }
      } else {
        document.querySelectorAll("[data-live]").forEach((el) => {
          if (el.dataset.live.split(/\s+/).includes(topic)) regions.add(el);
        });
      }
    }
    if (regions.size) {
      try {
        await swapRegions([...regions]);
      } catch {
        /* next event will retry */
      }
    }
  };

  const refresh = (topics) => {
    [].concat(topics).forEach((t) => queued.add(t));
    if (!refreshTimer) refreshTimer = setTimeout(runRefresh, 500); // coalesce bursts
  };
  const allTopics = () => {
    const found = new Set(Object.keys(window.fxLiveHandlers || {}));
    document
      .querySelectorAll("[data-live]")
      .forEach((el) =>
        el.dataset.live.split(/\s+/).forEach((t) => t && found.add(t)),
      );
    return [...found];
  };
  window.fxLive = { refresh, refreshAll: () => refresh(allTopics()) };

  /* ------------------------------------------------------------- the socket */
  const setLive = (on) => {
    if (!dot) return;
    dot.classList.toggle("on", on);
    dot.title = on ? "اتصال زنده برقرار است" : "در حال اتصال مجدد...";
  };

  // safety net while the socket is down: ask for the unread count now and then
  let pollTimer = null;
  const startPolling = () => {
    if (!pollTimer && hasBell)
      pollTimer = setInterval(() => bell.load(), 45000);
  };
  const stopPolling = () => {
    clearInterval(pollTimer);
    pollTimer = null;
  };

  if (typeof io === "undefined") {
    setLive(false);
    startPolling();
    return;
  }
  const socket = io({
    transports: ["websocket", "polling"],
    reconnectionDelay: 400,
    reconnectionDelayMax: 5000,
  });

  socket.on("deletion:requested", (d) => {
    if (typeof toast === "function")
      toast("درخواست حذف حساب جدید از " + d.username);
  });

  socket.on("notification", (n) => {
    if (hasBell) {
      bell.render(n, { prepend: true });
      bell.setUnread(bell.unread() + 1);
    }
    if (typeof toast === "function")
      toast(n.title + (n.body ? ": " + n.body : ""), "success");
    refresh("me"); // the member panel shows invoices, announcements and the subscription
  });

  socket.on("notifications:read", (d) => {
    if (hasBell) bell.syncRead(d.ids, d.unread);
  });
  socket.on("live", (d) => {
    if (d && Array.isArray(d.topics)) refresh(d.topics);
  });

  // after a drop we may have missed pushes: resync the bell AND every live region
  let firstConnect = true;
  socket.on("connect", () => {
    setLive(true);
    stopPolling();
    if (!firstConnect) {
      if (hasBell) bell.load();
      window.fxLive.refreshAll();
    }
    firstConnect = false;
  });
  socket.on("disconnect", () => {
    setLive(false);
    startPolling();
  });
  socket.on("connect_error", (err) => {
    setLive(false);
    if (err && err.message === "unauthorized") {
      socket.close();
      stopPolling();
    }
  });

  // coming back to a tab that was in the background: catch up right away
  let lastSync = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastSync > 20000) {
      lastSync = Date.now();
      if (hasBell) bell.load();
      window.fxLive.refreshAll();
    }
  });
})();
