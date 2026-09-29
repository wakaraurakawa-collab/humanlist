/* humanlist core: 日付ユーティリティと「継続作業の完了予測」ロジック（DOM非依存） */
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ds(d); };
  const dowOf = s => parse(s).getDay();
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fromMin = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const fmtDur = m => {
    m = Math.round(m);
    if (m < 60) return `${m}分`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}時間${r}分` : `${h}時間`;
  };
  const sumLog = (log, pred) =>
    Object.entries(log || {}).reduce((a, [d, v]) => (pred(d) ? a + (Number(v) || 0) : a), 0);

  const HORIZON = 730; // 予測する最大日数

  /**
   * 継続作業(series)の予測。
   * 過去分は実績(log)、今日以降は「残り時間を1日の作業量ずつ、対象曜日に割り当てる」。
   * 戻り値: { map: {日付: 予定分}, end: 完了予定日|null, remaining, doneTotal, finished }
   */
  function projectSeries(it, today) {
    const total = Number(it.total) || 0;
    const per = Number(it.perDay) || 0;
    const days = it.days && it.days.length ? it.days : [0, 1, 2, 3, 4, 5, 6];
    const start = it.startDate || today;
    const log = it.log || {};
    const doneTotal = sumLog(log, () => true);
    const remaining = Math.max(0, total - doneTotal);
    const res = { map: {}, end: null, remaining, doneTotal, finished: total > 0 && remaining <= 0 };
    if (res.finished) {
      // 完了日 = 最後に実績が付いた日
      const ds_ = Object.keys(log).filter(d => log[d] > 0).sort();
      res.end = ds_.length ? ds_[ds_.length - 1] : null;
      return res;
    }
    if (!per || total <= 0) return res;
    let rem = Math.max(0, total - sumLog(log, d => d < today));
    let d = start > today ? start : today;
    for (let i = 0; i < HORIZON && rem > 0; i++, d = addDays(d, 1)) {
      if (!days.includes(dowOf(d))) continue;
      const p = Math.min(per, rem);
      res.map[d] = p;
      // 今日は実績がそれ以上あればそちらを優先して消化したことにする
      rem -= d === today ? Math.min(rem, Math.max(p, Number(log[d]) || 0)) : p;
      if (rem <= 0) res.end = d;
    }
    return res;
  }

  function projectAll(items, today) {
    const out = {};
    for (const it of items) if (it.kind === 'series') out[it.id] = projectSeries(it, today);
    return out;
  }

  /**
   * ある日の予定一覧。
   * 各要素: { item, start(分|null), dur(分|null), planned(分|null), done(bool), doneMin }
   */
  function occurrences(items, date, today, proj) {
    const out = [];
    for (const it of items) {
      if (it.kind === 'series') {
        const p = proj[it.id];
        const logged = Number((it.log || {})[date]) || 0;
        let planned = date < today ? 0 : (p.map[date] || 0);
        if (date < today && logged <= 0) continue;
        if (planned <= 0 && logged <= 0) continue;
        if (planned <= 0) planned = logged;
        out.push({
          item: it, start: it.time ? toMin(it.time) : null, dur: planned,
          planned, doneMin: logged, done: logged >= planned && logged > 0,
        });
      } else if (it.kind === 'habit') {
        const days = it.days && it.days.length ? it.days : [0, 1, 2, 3, 4, 5, 6];
        if (date < (it.startDate || '0000-00-00') || !days.includes(dowOf(date))) continue;
        out.push({
          item: it, start: it.time ? toMin(it.time) : null, dur: Number(it.duration) || null,
          planned: Number(it.duration) || null, done: !!(it.log || {})[date], doneMin: 0,
        });
      } else if (it.kind === 'task') {
        const overdue = it.date && it.date < today && !it.done && date === today;
        if (it.date === date || overdue) {
          out.push({
            item: it, start: it.time ? toMin(it.time) : null, dur: Number(it.duration) || null,
            planned: Number(it.duration) || null, done: !!it.done, doneMin: 0, overdue: !!overdue,
          });
        }
      }
    }
    return out;
  }

  /** 習慣の連続達成日数（今日が未達でも昨日までの連続を数える） */
  function streak(it, today) {
    const days = it.days && it.days.length ? it.days : [0, 1, 2, 3, 4, 5, 6];
    let d = today, n = 0;
    if (!(it.log || {})[d]) d = addDays(d, -1);
    for (let i = 0; i < 1000; i++, d = addDays(d, -1)) {
      if (!days.includes(dowOf(d))) continue;
      if ((it.log || {})[d]) n++; else break;
    }
    return n;
  }

  const api = { pad, ds, parse, addDays, dowOf, toMin, fromMin, fmtDur, projectSeries, projectAll, occurrences, streak };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
