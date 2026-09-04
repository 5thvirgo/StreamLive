// Kickoff reminders via the browser Notification API. No server/account
// needed — reminders live in localStorage and fire while any StreamLive
// tab is open (this is a plain page script, not a service worker, so it
// can't wake up after the browser itself is fully closed).
(function () {
  const STORAGE_KEY = 'streamlive:reminders';
  const CHECK_INTERVAL_MS = 20000;
  const LEAD_TIME_MS = 10 * 60 * 1000; // notify 10 minutes before kickoff
  const GRACE_MS = 5 * 60 * 1000; // still fire up to 5 min after kickoff if the tab was closed
  const EXPIRE_MS = 3 * 60 * 60 * 1000; // drop reminders 3h after kickoff

  function getReminders() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  function saveReminders(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {}
  }

  function checkReminders() {
    const list = getReminders();
    if (list.length === 0) return;
    const now = Date.now();
    let changed = false;

    for (const r of list) {
      const kickoff = new Date(r.kickoff).getTime();
      if (!r.notified && now >= kickoff - LEAD_TIME_MS && now < kickoff + GRACE_MS) {
        if (Notification.permission === 'granted') {
          const n = new Notification(`Kicking off soon: ${r.title}`, {
            body: `${r.teams} — ${new Date(r.kickoff).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
            tag: r.fixtureId,
          });
          n.onclick = () => { window.focus(); n.close(); };
        }
        r.notified = true;
        changed = true;
      }
    }

    const kept = list.filter((r) => now < new Date(r.kickoff).getTime() + EXPIRE_MS);
    if (kept.length !== list.length) changed = true;
    if (changed) saveReminders(kept);
  }

  window.StreamLiveReminders = {
    has(fixtureId) {
      return getReminders().some((r) => r.fixtureId === fixtureId);
    },
    add(reminder) {
      if (!('Notification' in window)) {
        return Promise.resolve({ ok: false, reason: 'unsupported' });
      }
      return Notification.requestPermission().then((perm) => {
        if (perm !== 'granted') return { ok: false, reason: 'denied' };
        const list = getReminders().filter((r) => r.fixtureId !== reminder.fixtureId);
        list.push(Object.assign({ notified: false }, reminder));
        saveReminders(list);
        return { ok: true };
      });
    },
    remove(fixtureId) {
      saveReminders(getReminders().filter((r) => r.fixtureId !== fixtureId));
    },
  };

  setInterval(checkReminders, CHECK_INTERVAL_MS);
  checkReminders();
})();
