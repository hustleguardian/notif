(function (global) {
  const MS_PER_DAY = 86400000;

  function getNow(fakeNowIso) {
    return fakeNowIso ? new Date(fakeNowIso) : new Date();
  }

  function nextDueDate(anchorIso, intervalCount, intervalUnit) {
    const anchor = new Date(anchorIso);
    if (intervalUnit === 'day') {
      return new Date(anchor.getTime() + intervalCount * MS_PER_DAY);
    }
    if (intervalUnit === 'week') {
      return new Date(anchor.getTime() + intervalCount * 7 * MS_PER_DAY);
    }
    if (intervalUnit === 'month') {
      const due = new Date(anchor.getTime());
      due.setMonth(due.getMonth() + intervalCount);
      return due;
    }
    throw new Error('Unknown intervalUnit: ' + intervalUnit);
  }

  function formatFrequency(intervalCount, intervalUnit) {
    const forms = {
      day: { article: 'tous les', plural: 'jours' },
      week: { article: 'toutes les', plural: 'semaines' },
      month: { article: 'tous les', plural: 'mois' },
    };
    const f = forms[intervalUnit];
    if (!f) throw new Error('Unknown intervalUnit: ' + intervalUnit);
    return intervalCount === 1
      ? `${f.article} ${f.plural}`
      : `${f.article} ${intervalCount} ${f.plural}`;
  }

  function computeCycleStatus({ anchorIso, intervalCount, intervalUnit, now }) {
    const anchor = new Date(anchorIso);
    const nextDue = nextDueDate(anchorIso, intervalCount, intervalUnit);
    const totalMs = nextDue.getTime() - anchor.getTime();
    const remainingMs = nextDue.getTime() - now.getTime();

    if (remainingMs <= 0) {
      return {
        status: 'red',
        daysLeft: 0,
        daysLate: Math.max(0, Math.floor(-remainingMs / MS_PER_DAY)),
        pct: 1,
      };
    }

    const ratio = remainingMs / totalMs;
    const status = ratio < 0.25 ? 'amber' : 'green';
    return {
      status,
      daysLeft: Math.ceil(remainingMs / MS_PER_DAY),
      daysLate: 0,
      pct: Math.min(1, Math.max(0, (now.getTime() - anchor.getTime()) / totalMs)),
    };
  }

  function dateStrDaysAgo(now, daysAgo) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function completionIsoForDateStr(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
  }

  function evalActivity(act, now) {
    if (act.endDate) {
      const end = new Date(act.endDate + 'T23:59:59');
      if (now > end) {
        return { status: 'ended', daysLeft: 0, daysLate: 0, pct: 1 };
      }
    }
    const anchorIso = act.completions.length
      ? act.completions[act.completions.length - 1]
      : act.createdAt;
    return computeCycleStatus({
      anchorIso, intervalCount: act.intervalCount, intervalUnit: act.intervalUnit, now,
    });
  }

  // A literal daily habit ("tous les jours") is about "did you do this
  // today", so it stays outstanding regardless of color until it's actually
  // been completed today — the amber/red threshold (built for "close to
  // due") would otherwise hide it for most of the day. Any other cadence
  // (including "tous les 3 jours") uses the amber/red threshold so it
  // doesn't nag while there's still plenty of time left in its cycle.
  function isOutstanding(act, now) {
    const st = evalActivity(act, now);
    if (st.status === 'ended') return false;
    // Never actually completed, ever — always outstanding regardless of color.
    // A fresh activity is "green" just because its cycle hasn't expired yet,
    // not because it was done; showing it as "Fait" would be a false claim.
    if (act.completions.length === 0) return true;
    const isDailyHabit = act.intervalUnit === 'day' && act.intervalCount === 1;
    if (isDailyHabit) {
      const todayStr = dateStrDaysAgo(now, 0);
      return !act.completions.some(ts => dateStrDaysAgo(new Date(ts), 0) === todayStr);
    }
    return st.status === 'amber' || st.status === 'red';
  }


  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  const PRIORITY_LABELS = { high: 'Haute', medium: 'Moyenne', low: 'Basse' };

  function priorityLabel(priority) {
    const label = PRIORITY_LABELS[priority];
    if (!label) throw new Error('Unknown priority: ' + priority);
    return label;
  }

  function sortTodos(todos) {
    return [...todos].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    });
  }

  function buildDigest(activities, todos, now) {
    const groups = { day: [], week: [], month: [] };
    let hasDayActivities = false;
    for (const act of activities) {
      const st = evalActivity(act, now);
      if (st.status === 'ended') continue;
      if (act.intervalUnit === 'day') hasDayActivities = true;
      if (isOutstanding(act, now)) {
        groups[act.intervalUnit].push(act.name);
      }
    }
    const todo = sortTodos(todos).filter(t => !t.done).map(t => t.name);
    return { today: groups.day, week: groups.week, month: groups.month, todo, hasDayActivities };
  }

  function formatDigestSection(label, items) {
    return `${label} :\n${items.map(item => `- ${item}`).join('\n')}`;
  }

  function formatDigestNotification(digest) {
    const sections = [];
    if (digest.today.length > 0) {
      sections.push(formatDigestSection("Aujourd'hui", digest.today));
    } else if (digest.hasDayActivities) {
      sections.push(`Aujourd'hui : tout fait ✓`);
    }
    if (digest.week.length > 0) sections.push(formatDigestSection('Cette semaine', digest.week));
    if (digest.month.length > 0) sections.push(formatDigestSection('Ce mois', digest.month));
    if (digest.todo && digest.todo.length > 0) sections.push(formatDigestSection('À faire', digest.todo));
    return { title: 'Cadence', body: sections.join('\n\n') };
  }

  const CHECKPOINTS = [
    { id: 'morning', hour: 9 },
    { id: 'midday', hour: 12 },
    { id: 'evening', hour: 17 },
  ];

  function nextCheckpointToFire(now, state) {
    const todayStr = dateStrDaysAgo(now, 0);
    const sent = (state && state.date === todayStr) ? { ...state.sent } : {};
    const passed = CHECKPOINTS.filter(c => now.getHours() >= c.hour);
    const unsent = passed.filter(c => !sent[c.id]);

    if (unsent.length === 0) {
      return { checkpointId: null, newState: { date: todayStr, sent } };
    }

    const toFire = unsent[unsent.length - 1];
    const newSent = { ...sent };
    passed.forEach(c => { newSent[c.id] = true; });
    return { checkpointId: toFire.id, newState: { date: todayStr, sent: newSent } };
  }

  function startOfWeek(date) {
    const day = (date.getDay() + 6) % 7; // Monday = 0
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - day);
  }

  function sameCalendarPeriod(a, b, intervalUnit) {
    if (intervalUnit === 'week') return startOfWeek(a).getTime() === startOfWeek(b).getTime();
    if (intervalUnit === 'month') return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
    return dateStrDaysAgo(a, 0) === dateStrDaysAgo(b, 0); // day (any intervalCount)
  }

  // "Annuler" removes every completion from the same day/week/month (matching
  // the activity's own cadence unit) as the most recent one — not just that
  // single timestamp — so a burst of accidental repeat taps undoes in one
  // click instead of requiring one click per stray tap.
  function undoLastCompletionPeriod(completions, intervalUnit) {
    if (completions.length === 0) return [];
    const last = new Date(completions[completions.length - 1]);
    return completions.filter(ts => !sameCalendarPeriod(new Date(ts), last, intervalUnit));
  }

  function migrateActivity(act, nowIso) {
    if (act.intervalUnit) return act;
    const { period, target, ...rest } = act;
    return {
      ...rest,
      intervalUnit: period || 'week',
      intervalCount: 1,
      createdAt: (act.completions && act.completions[0]) || nowIso,
    };
  }

  const api = {
    getNow, nextDueDate, formatFrequency, computeCycleStatus, migrateActivity,
    dateStrDaysAgo, completionIsoForDateStr, evalActivity, isOutstanding, buildDigest,
    formatDigestNotification, nextCheckpointToFire, priorityLabel, sortTodos,
    undoLastCompletionPeriod,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CadenceLogic = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
