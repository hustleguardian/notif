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

  const api = { getNow, nextDueDate, formatFrequency, computeCycleStatus, migrateActivity, dateStrDaysAgo, completionIsoForDateStr };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CadenceLogic = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
