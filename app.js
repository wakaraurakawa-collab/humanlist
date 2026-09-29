/* humanlist UI */
(function () {
  const C = window.Core;
  const $ = s => document.querySelector(s);
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const KEY = 'humanlist.v1';
  const COLORS = ['#4f7cff', '#e5734b', '#3aa675', '#a35bd6', '#d9a520', '#d2467c', '#2fa3b8'];

  // ---------- state ----------
  let state = load();
  const ui = { tab: 'day', date: C.ds(new Date()), wbsStart: null, editing: null };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.items)) return { settings: {}, ...s };
    } catch (e) { /* 壊れていたら初期化 */ }
    return { items: [], settings: {} };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { alert('保存に失敗しました（容量/プライベートモード？）'); }
  }
  const today = () => C.ds(new Date());
  const uid = () => Math.random().toString(36).slice(2, 10);
  const byId = id => state.items.find(i => i.id === id);
  const colorFor = it => it.color || COLORS[[...it.id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];

  // ---------- tiny DOM helper ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const fmtDate = s => { const d = C.parse(s); return `${d.getMonth() + 1}/${d.getDate()}(${DOW[d.getDay()]})`; };

  // ---------- actions ----------
  function toggleOcc(occ, date) {
    const it = occ.item;
    if (it.kind === 'task') { it.done = !it.done; it.doneAt = it.done ? today() : null; }
    else if (it.kind === 'habit') { it.log = it.log || {}; if (it.log[date]) delete it.log[date]; else it.log[date] = 1; }
    else if (it.kind === 'series') {
      it.log = it.log || {};
      if (occ.done) delete it.log[date]; else it.log[date] = occ.planned;
    }
    save(); render();
  }
  function logMinutes(it, date, current) {
    const v = prompt(`「${it.title}」の ${fmtDate(date)} の実績（分）`, current || it.perDay || 60);
    if (v === null) return;
    const n = Math.max(0, Math.round(Number(v)));
    if (Number.isNaN(n)) return;
    it.log = it.log || {};
    if (n === 0) delete it.log[date]; else it.log[date] = n;
    save(); render();
  }

  // ---------- render ----------
  function render() {
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === ui.tab);
    for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== 'view-' + ui.tab;
    ({ day: renderDay, wbs: renderWbs, tasks: renderTasks, memo: renderMemo })[ui.tab]();
  }

  // ----- 今日 (タイムライン) -----
  const PX = 56; // 1時間あたりのpx
  function renderDay() {
    const root = $('#view-day'); root.replaceChildren();
    const T = today();
    const proj = C.projectAll(state.items, T);
    const occs = C.occurrences(state.items, ui.date, T, proj);

    const nav = h('div', { class: 'datenav' },
      h('button', { onclick: () => shiftDate(-1) }, '‹'),
      h('strong', {}, `${fmtDate(ui.date)}${ui.date === T ? '  今日' : ''}`),
      h('button', { onclick: () => shiftDate(1) }, '›'),
      ui.date !== T && h('button', { onclick: () => { ui.date = T; render(); } }, '今日へ'));
    root.append(nav);

    const timed = occs.filter(o => o.start != null).sort((a, b) => a.start - b.start);
    const untimed = occs.filter(o => o.start == null);

    // 時間未定
    const someday = ui.date === T ? state.items.filter(i => i.kind === 'task' && !i.date && !i.done) : [];
    if (untimed.length || someday.length) {
      const box = h('div', { class: 'card' }, h('h3', {}, '時間未定'));
      for (const o of untimed) box.append(occRow(o, ui.date));
      for (const t of someday) box.append(occRow({ item: t, start: null, dur: t.duration || null, planned: t.duration || null, done: false }, ui.date, 'いつでも'));
      root.append(box);
    }

    // タイムライン
    if (!timed.length && !untimed.length && !someday.length) {
      root.append(h('p', { class: 'empty' }, 'この日の予定はありません。「＋ 追加」から登録できます。'));
      return;
    }
    if (timed.length) {
      const startH = Math.min(6, Math.floor(timed[0].start / 60));
      const endH = Math.min(24, Math.max(22, Math.ceil(Math.max(...timed.map(o => o.start + (o.dur || 30))) / 60)) + 1);
      const tl = h('div', { class: 'timeline', style: `height:${(endH - startH) * PX}px` });
      for (let hr = startH; hr < endH; hr++)
        tl.append(h('div', { class: 'hour', style: `top:${(hr - startH) * PX}px` }, h('span', {}, `${hr}:00`)));
      layoutColumns(timed).forEach(({ o, col, cols }) => {
        const dur = o.dur || 30;
        const top = (o.start / 60 - startH) * PX;
        const it = o.item;
        const blk = h('div', {
          class: 'block' + (o.done ? ' done' : ''),
          style: `top:${top}px;height:${Math.max(dur / 60 * PX - 2, 26)}px;left:calc(${col / cols * 100}% + 44px * ${1 - col / cols});width:calc(${100 / cols}% - 44px / ${cols});--c:${colorFor(it)}`,
        },
          h('input', { type: 'checkbox', checked: o.done, onchange: () => toggleOcc(o, ui.date) }),
          h('div', { class: 'bt', onclick: () => openDialog(it) },
            h('b', {}, it.title),
            h('small', {}, `${C.fromMin(o.start)}${o.dur ? '–' + C.fromMin(o.start + o.dur) : ''}${badge(o, proj)}`)));
        tl.append(blk);
      });
      if (ui.date === T) {
        const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
        if (m / 60 >= startH && m / 60 <= endH) tl.append(h('div', { class: 'now', style: `top:${(m / 60 - startH) * PX}px` }));
      }
      root.append(tl);
    }
  }
  function badge(o, proj) {
    const it = o.item;
    if (it.kind === 'series') { const p = proj[it.id]; return ` ・残り${C.fmtDur(p.remaining)}`; }
    if (o.overdue) return ' ・期限切れ';
    return '';
  }
  function layoutColumns(list) {
    const res = []; let cluster = [], clusterEnd = -1;
    const flush = () => {
      const colEnds = [];
      for (const o of cluster) {
        let c = colEnds.findIndex(e => e <= o.start);
        if (c < 0) { c = colEnds.length; colEnds.push(0); }
        colEnds[c] = o.start + (o.dur || 30);
        o._c = c;
      }
      cluster.forEach(o => res.push({ o, col: o._c, cols: colEnds.length }));
      cluster = []; clusterEnd = -1;
    };
    for (const o of list) {
      if (cluster.length && o.start >= clusterEnd) flush();
      cluster.push(o); clusterEnd = Math.max(clusterEnd, o.start + (o.dur || 30));
    }
    if (cluster.length) flush();
    return res;
  }
  function occRow(o, date, sub) {
    const it = o.item;
    const proj = C.projectAll(state.items, today());
    const extra = it.kind === 'series' ? `${C.fmtDur(o.planned)}${badge(o, proj)}`
      : [sub, o.dur && C.fmtDur(o.dur), o.overdue && `期限切れ(${fmtDate(it.date)})`].filter(Boolean).join(' ・ ');
    return h('div', { class: 'row-item' + (o.done ? ' done' : ''), style: `--c:${colorFor(it)}` },
      h('input', { type: 'checkbox', checked: o.done, onchange: () => toggleOcc(o, date) }),
      h('div', { class: 'grow', onclick: () => openDialog(it) }, h('b', {}, it.title), h('small', {}, extra)));
  }
  function shiftDate(n) { ui.date = C.addDays(ui.date, n); render(); }

  // ----- WBS -----
  function renderWbs() {
    const root = $('#view-wbs'); root.replaceChildren();
    const T = today();
    const N = 14;
    if (!ui.wbsStart) ui.wbsStart = T;
    const dates = Array.from({ length: N }, (_, i) => C.addDays(ui.wbsStart, i));
    const proj = C.projectAll(state.items, T);

    root.append(h('div', { class: 'datenav' },
      h('button', { onclick: () => { ui.wbsStart = C.addDays(ui.wbsStart, -7); render(); } }, '‹ 前の週'),
      h('strong', {}, `${fmtDate(dates[0])} 〜 ${fmtDate(dates[N - 1])}`),
      h('button', { onclick: () => { ui.wbsStart = C.addDays(ui.wbsStart, 7); render(); } }, '次の週 ›'),
      ui.wbsStart !== T && h('button', { onclick: () => { ui.wbsStart = T; render(); } }, '今日へ')));

    const rows = [];
    const cellsFor = it => dates.map(d => {
      const o = C.occurrences([it], d, T, proj).find(x => x.item === it);
      return o || null;
    });
    const groups = [
      ['継続作業', state.items.filter(i => i.kind === 'series' && !proj[i.id].finished)],
      ['習慣', state.items.filter(i => i.kind === 'habit')],
      ['単発タスク', state.items.filter(i => i.kind === 'task' && (i.date ? dates.includes(i.date) || (i.date < T && !i.done) : !i.done))],
    ];
    const totals = new Array(N).fill(0);

    const table = h('table', { class: 'wbs' });
    const head = h('tr', {}, h('th', { class: 'name' }, '項目'));
    dates.forEach(d => head.append(h('th', {
      class: (d === T ? 'today ' : '') + ([0, 6].includes(C.dowOf(d)) ? 'we' : ''),
      onclick: () => { ui.date = d; ui.tab = 'day'; render(); },
    }, `${C.parse(d).getDate()}`, h('br'), DOW[C.dowOf(d)])));
    head.append(h('th', { class: 'end' }, '完了予定'));
    table.append(h('thead', {}, head));

    const tb = h('tbody');
    for (const [label, items] of groups) {
      if (!items.length) continue;
      tb.append(h('tr', { class: 'grp' }, h('td', { colspan: N + 2 }, label)));
      for (const it of items) {
        const cells = cellsFor(it);
        const tr = h('tr', { style: `--c:${colorFor(it)}` });
        const sub = it.kind === 'series'
          ? `残り${C.fmtDur(proj[it.id].remaining)} / ${C.fmtDur(it.total)}`
          : it.kind === 'habit' ? (it.time ? it.time + '〜' : '') : (it.time ? it.time : (it.date ? '' : 'いつでも'));
        tr.append(h('td', { class: 'name', onclick: () => openDialog(it) }, h('b', {}, it.title), h('small', {}, sub)));
        cells.forEach((o, i) => {
          const d = dates[i];
          const td = h('td', { class: (d === T ? 'today ' : '') + ([0, 6].includes(C.dowOf(d)) ? 'we' : '') });
          if (o) {
            if (it.kind === 'series') {
              totals[i] += o.planned;
              const last = proj[it.id].end === d;
              td.append(h('div', { class: 'bar' + (o.done ? ' done' : '') + (last ? ' last' : ''), title: it.title },
                o.planned >= 60 && o.planned % 30 === 0 ? o.planned / 60 + 'h' : o.planned + 'm'));
            } else {
              if (o.dur) totals[i] += o.dur;
              td.append(h('div', { class: 'dot' + (o.done ? ' done' : '') + (it.kind === 'task' ? ' sq' : '') }, o.done ? '✓' : ''));
            }
          }
          tr.append(td);
        });
        const endTxt = it.kind === 'series' ? (proj[it.id].end ? fmtDate(proj[it.id].end) : '—') : '';
        tr.append(h('td', { class: 'end' }, endTxt));
        tb.append(tr);
      }
    }
    if (!tb.children.length) {
      root.append(h('p', { class: 'empty' }, 'まだ項目がありません。「＋ 追加」から登録してください。'));
      return;
    }
    const foot = h('tr', { class: 'tot' }, h('td', { class: 'name' }, '予定作業時間'));
    totals.forEach((m, i) => foot.append(h('td', { class: dates[i] === T ? 'today' : '' }, m ? (m / 60).toFixed(m % 60 ? 1 : 0) + 'h' : '')));
    foot.append(h('td'));
    tb.append(foot);
    table.append(tb);
    root.append(h('div', { class: 'scroll' }, table),
      h('p', { class: 'hint' }, '日付をタップするとその日のタイムラインへ。バーは継続作業の予定時間、右端の濃い色が最終日です。'));
  }

  // ----- タスク一覧 -----
  function renderTasks() {
    const root = $('#view-tasks'); root.replaceChildren();
    const T = today();
    const proj = C.projectAll(state.items, T);

    const quick = h('form', { class: 'quick', onsubmit: e => {
      e.preventDefault();
      const v = e.target.q.value.trim(); if (!v) return;
      state.items.push({ id: uid(), kind: 'task', title: v, date: '', time: '', duration: '', done: false });
      save(); render();
    } }, h('input', { name: 'q', placeholder: '単発タスクをすばやく追加（Enter）— 日時は後から設定できます' }), h('button', { class: 'primary' }, '追加'));
    root.append(quick);

    const series = state.items.filter(i => i.kind === 'series');
    if (series.length) {
      const box = h('div', { class: 'card' }, h('h3', {}, '継続作業'));
      for (const it of series) {
        const p = proj[it.id]; const pct = it.total ? Math.min(100, p.doneTotal / it.total * 100) : 0;
        const days = it.days && it.days.length < 7 ? it.days.map(d => DOW[d]).join('') : '毎日';
        box.append(h('div', { class: 'proj', style: `--c:${colorFor(it)}` },
          h('div', { class: 'ph' }, h('b', { onclick: () => openDialog(it) }, it.title),
            h('span', { class: 'eta' }, p.finished ? '✔ 完了' : p.end ? `完了予定 ${fmtDate(p.end)}` : '予定なし')),
          h('div', { class: 'progress' }, h('i', { style: `width:${pct}%` })),
          h('small', {}, `${C.fmtDur(p.doneTotal)} / ${C.fmtDur(it.total)}（残り${C.fmtDur(p.remaining)}）・${days} ${C.fmtDur(it.perDay)}/日${it.time ? ' ' + it.time + '〜' : ''}`),
          h('div', { class: 'mini' },
            h('button', { onclick: () => logMinutes(it, T, (it.log || {})[T]) }, '今日の実績を入力'),
            h('button', { onclick: () => openDialog(it) }, '編集'))));
      }
      root.append(box);
    }

    const habits = state.items.filter(i => i.kind === 'habit');
    if (habits.length) {
      const box = h('div', { class: 'card' }, h('h3', {}, '習慣'));
      for (const it of habits) {
        const days = it.days && it.days.length < 7 ? it.days.map(d => DOW[d]).join('') : '毎日';
        const o = C.occurrences([it], T, T, {}).find(x => x.item === it);
        box.append(h('div', { class: 'row-item', style: `--c:${colorFor(it)}` },
          o ? h('input', { type: 'checkbox', checked: o.done, onchange: () => toggleOcc(o, T) }) : h('span', { class: 'sp' }),
          h('div', { class: 'grow', onclick: () => openDialog(it) }, h('b', {}, it.title),
            h('small', {}, `${days}${it.time ? ' ' + it.time : ''} ・ 🔥 ${C.streak(it, T)}日連続`))));
      }
      root.append(box);
    }

    const tasks = state.items.filter(i => i.kind === 'task');
    const open = tasks.filter(t => !t.done).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '').localeCompare(b.time || ''));
    const done = tasks.filter(t => t.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
    const tbox = h('div', { class: 'card' }, h('h3', {}, `単発タスク（${open.length}）`));
    if (!open.length) tbox.append(h('p', { class: 'empty small' }, '未完了のタスクはありません'));
    for (const t of open) tbox.append(taskRow(t, T));
    root.append(tbox);
    if (done.length) {
      const d = h('details', { class: 'card' }, h('summary', {}, `完了済み（${done.length}）`));
      for (const t of done.slice(0, 50)) d.append(taskRow(t, T));
      d.append(h('button', { class: 'linklike', onclick: () => {
        if (confirm('完了済みタスクをすべて削除しますか？')) { state.items = state.items.filter(i => !(i.kind === 'task' && i.done)); save(); render(); }
      } }, '完了済みを全部削除'));
      root.append(d);
    }

    root.append(h('div', { class: 'card data' },
      h('h3', {}, 'データ'),
      h('div', { class: 'mini' },
        h('button', { onclick: exportData }, 'バックアップを書き出す'),
        h('label', { class: 'btnlike' }, '読み込む', h('input', { type: 'file', accept: 'application/json', hidden: true, onchange: importData })),
        h('button', { onclick: setupWeather }, '天気の地点を設定')),
      h('small', {}, 'データはこのブラウザの中にだけ保存されます。端末を変えるときはバックアップを使ってください。')));
  }
  function taskRow(t, T) {
    const o = { item: t, done: t.done, overdue: t.date && t.date < T && !t.done };
    const meta = [t.date ? fmtDate(t.date) : 'いつでも', t.time, t.duration && C.fmtDur(t.duration), o.overdue && '期限切れ'].filter(Boolean).join(' ・ ');
    return h('div', { class: 'row-item' + (t.done ? ' done' : ''), style: `--c:${colorFor(t)}` },
      h('input', { type: 'checkbox', checked: t.done, onchange: () => toggleOcc(o, T) }),
      h('div', { class: 'grow', onclick: () => openDialog(t) }, h('b', {}, t.title), h('small', {}, meta)));
  }

  // ----- メモ -----
  function renderMemo() {
    const root = $('#view-memo'); root.replaceChildren();
    root.append(h('form', { class: 'quick', onsubmit: e => {
      e.preventDefault();
      const v = e.target.q.value.trim(); if (!v) return;
      state.items.push({ id: uid(), kind: 'memo', title: v.split('\n')[0].slice(0, 40), text: v, created: today() });
      save(); render();
    } }, h('textarea', { name: 'q', rows: 2, placeholder: '忘備録をメモ…' }), h('button', { class: 'primary' }, '保存')));
    const memos = state.items.filter(i => i.kind === 'memo').reverse();
    if (!memos.length) root.append(h('p', { class: 'empty' }, 'メモはまだありません。'));
    for (const m of memos)
      root.append(h('div', { class: 'card memo', onclick: () => openDialog(m) },
        h('div', { class: 'mt' }, m.text), h('small', {}, m.created ? fmtDate(m.created) : '')));
  }

  // ---------- add / edit dialog ----------
  const dlg = $('#dlg'), form = $('#form');
  const HINTS = {
    task: '一回きりのやること。日時や所要時間は決めなくてもOK。',
    series: '何日もかけて進める作業。合計時間と1日の作業量から完了予定日を自動計算します。',
    habit: '毎日/決まった曜日にチェックするもの（早寝早起き、運動など）。連続日数を数えます。',
    memo: '日付や時間のない忘備録。',
  };
  function dayChips(container, sel) {
    container.replaceChildren();
    DOW.forEach((n, i) => container.append(h('label', {}, h('input', { type: 'checkbox', value: i, checked: sel.includes(i) }), h('span', {}, n))));
  }
  const chosenDays = c => [...c.querySelectorAll('input:checked')].map(i => Number(i.value));
  function setKind(k) {
    form.kind.value = k;
    for (const el of form.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(k);
    $('#kindHint').textContent = HINTS[k];
    form.title.required = k !== 'memo';
    form.title.closest('label').hidden = k === 'memo';
    updatePreview();
  }
  function draftSeries() {
    return {
      id: 'draft', kind: 'series', total: Math.round(Number(form.totalH.value) * 60), perDay: Number(form.perDay.value),
      startDate: form.startDate.value || today(), days: chosenDays($('#daysSeries')),
      log: ui.editing && ui.editing.kind === 'series' ? ui.editing.log : {},
    };
  }
  function updatePreview() {
    const el = $('#preview');
    if (form.kind.value !== 'series') return;
    const d = draftSeries();
    if (!d.total || !d.perDay || !d.days.length) { el.textContent = '合計時間・1日の作業量・曜日を入れると完了予定が出ます。'; return; }
    const p = C.projectSeries(d, today());
    const n = Object.keys(p.map).length;
    el.textContent = p.finished ? '✔ すでに完了しています。'
      : p.end ? `残り ${C.fmtDur(p.remaining)} → 作業日 ${n}日、完了予定 ${fmtDate(p.end)}` : '';
  }

  function openDialog(item) {
    ui.editing = item || null;
    form.reset();
    $('#dlgTitle').textContent = item ? '編集' : '追加';
    $('#delBtn').hidden = !item;
    $('#kindSeg').hidden = !!item;
    const all = [0, 1, 2, 3, 4, 5, 6];
    dayChips($('#daysSeries'), item && item.kind === 'series' ? item.days : all);
    dayChips($('#daysHabit'), item && item.kind === 'habit' ? item.days : all);
    form.startDate.value = today();
    let kind = item ? item.kind : (ui.tab === 'memo' ? 'memo' : ui.tab === 'tasks' ? 'task' : 'task');
    if (item) {
      form.title.value = item.title || '';
      form.note.value = item.note || '';
      if (kind === 'task') { form.date.value = item.date || ''; form.time.value = item.time || ''; form.duration.value = item.duration || ''; }
      if (kind === 'series') { form.totalH.value = item.total / 60; form.perDay.value = item.perDay; form.startDate.value = item.startDate || today(); form.stime.value = item.time || ''; }
      if (kind === 'habit') { form.htime.value = item.time || ''; form.hduration.value = item.duration || ''; }
      if (kind === 'memo') form.text.value = item.text || '';
    } else if (ui.tab === 'day') form.date.value = ui.date;
    setKind(kind);
    dlg.showModal();
  }
  form.addEventListener('input', updatePreview);
  form.addEventListener('change', e => { if (e.target.name === 'kind') setKind(e.target.value); updatePreview(); });
  $('#cancelBtn').onclick = () => dlg.close();
  $('#delBtn').onclick = () => {
    if (ui.editing && confirm(`「${ui.editing.title}」を削除しますか？`)) {
      state.items = state.items.filter(i => i !== ui.editing); save(); dlg.close(); render();
    }
  };
  form.addEventListener('submit', e => {
    e.preventDefault();
    const k = form.kind.value;
    const it = ui.editing || { id: uid(), kind: k };
    if (k === 'memo') {
      it.text = form.text.value.trim(); if (!it.text) return;
      it.title = it.text.split('\n')[0].slice(0, 40); it.created = it.created || today();
    } else {
      it.title = form.title.value.trim(); it.note = form.note.value.trim();
      if (k === 'task') { it.date = form.date.value; it.time = form.time.value; it.duration = Number(form.duration.value) || ''; it.done = !!it.done; }
      if (k === 'series') {
        const d = draftSeries();
        if (!d.total || !d.perDay) return alert('合計時間と1日の作業量を入れてください');
        if (!d.days.length) return alert('曜日を1つ以上選んでください');
        Object.assign(it, { total: d.total, perDay: d.perDay, startDate: form.startDate.value || today(), days: d.days, time: form.stime.value, log: it.log || {} });
      }
      if (k === 'habit') Object.assign(it, { time: form.htime.value, duration: Number(form.hduration.value) || '', days: chosenDays($('#daysHabit')), log: it.log || {}, startDate: it.startDate || today() });
      if (k === 'habit' && !it.days.length) return alert('曜日を1つ以上選んでください');
    }
    if (!ui.editing) state.items.push(it);
    save(); dlg.close(); render();
  });

  // ---------- data ----------
  function exportData() {
    const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })), download: `humanlist-${today()}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  }
  function importData(e) {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => {
      const s = JSON.parse(t);
      if (!Array.isArray(s.items)) throw new Error('形式が違います');
      if (!confirm('現在のデータを置き換えます。よろしいですか？')) return;
      state = { settings: {}, ...s }; save(); render(); loadWeather();
    }).catch(err => alert('読み込めませんでした: ' + err.message));
  }

  // ---------- weather (Open-Meteo, キー不要) ----------
  const RAIN_THRESHOLD = 50;
  function setupWeather() {
    if (!navigator.geolocation) return alert('位置情報が使えません');
    navigator.geolocation.getCurrentPosition(pos => {
      state.settings.lat = +pos.coords.latitude.toFixed(3); state.settings.lon = +pos.coords.longitude.toFixed(3);
      save(); loadWeather(true);
    }, () => alert('位置情報を取得できませんでした。東京の天気を表示します。'));
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }
  async function loadWeather(force) {
    const box = $('#weather');
    const { lat = 35.681, lon = 139.767 } = state.settings;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability&forecast_days=2&timezone=auto`;
      const r = await fetch(url); if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      const now = new Date(), T = today();
      const hits = j.hourly.time.map((t, i) => ({ t, p: j.hourly.precipitation_probability[i] }))
        .filter(x => x.t.startsWith(T) && Number(x.t.slice(11, 13)) >= now.getHours() && x.p >= RAIN_THRESHOLD);
      if (!hits.length) { box.hidden = false; box.className = 'weather ok'; box.textContent = '☀️ 今日はこのあと雨の心配は少なそうです'; return; }
      const from = Number(hits[0].t.slice(11, 13)), max = Math.max(...hits.map(x => x.p));
      const msg = `☔ ${from}時ごろから雨の可能性（最大${max}%）。傘を忘れずに`;
      box.hidden = false; box.className = 'weather rain'; box.textContent = msg;
      if ('Notification' in window && Notification.permission === 'granted' && state.settings.notified !== T) {
        state.settings.notified = T; save(); new Notification('humanlist', { body: msg });
      }
    } catch (e) { box.hidden = true; }
  }

  // ---------- init ----------
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { ui.tab = b.dataset.tab; render(); } });
  $('#addBtn').onclick = () => openDialog(null);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  setInterval(() => { if (ui.tab === 'day') render(); }, 60000);
  render(); loadWeather();
})();
