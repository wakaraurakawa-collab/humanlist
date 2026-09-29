/* humanlist UI */
(function () {
  const C = window.Core;
  const $ = s => document.querySelector(s);
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const KEY = 'humanlist.v1';
  const COLORS = ['#4f7cff', '#e5734b', '#3aa675', '#a35bd6', '#d9a520', '#d2467c', '#2fa3b8'];

  // ---------- state ----------
  let state = load();
  const ui = { pin: null, tab: 'day', date: C.ds(new Date()), wbsStart: null, editing: null };

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
    $('main').classList.toggle('wide', ui.tab === 'day');
    ({ day: renderDay, wbs: renderWbs, tasks: renderTasks, memo: renderMemo })[ui.tab]();
  }

  // ----- 今日 (カレンダー ⇄ WBS/TODO を線でつなぐ) -----
  const PX = 56; // 1時間あたりのpx
  const SVGNS = 'http://www.w3.org/2000/svg';
  const STRIP = 14; // 右のWBSに並べる日数
  const VIEWS = [[1, '1日'], [3, '3日'], [7, '週']];
  const isNarrow = () => window.matchMedia('(max-width:759px)').matches;
  const viewN = () => [1, 3, 7].includes(Number(state.settings.view)) ? Number(state.settings.view) : (isNarrow() ? 1 : 7);
  let suppressClick = false; // ドラッグ直後のclickを無視する
  const SNAP = 15; // 分
  // 週表示は月曜始まり。1日/3日は選択日から
  function viewStart() {
    if (viewN() !== 7) return ui.date;
    return C.addDays(ui.date, -((C.parse(ui.date).getDay() + 6) % 7));
  }

  function renderDay() {
    const root = $('#view-day'); root.replaceChildren();
    const T = today(), n = viewN(), start = viewStart();
    const dates = Array.from({ length: n }, (_, i) => C.addDays(start, i));
    const proj = C.projectAll(state.items, T);
    const perDay = dates.map(d => C.occurrences(state.items, d, T, proj));
    const isWe = d => [0, 6].includes(C.dowOf(d));

    root.append(h('div', { class: 'datenav' },
      h('div', { class: 'seg2' }, VIEWS.map(([v, t]) => h('button', { class: n === v ? 'on' : '', onclick: () => { state.settings.view = v; save(); render(); } }, t))),
      h('button', { onclick: () => shiftDate(-n) }, '‹'),
      h('strong', {}, n === 1 ? `${fmtDate(start)}${start === T ? ' 今日' : ''}` : `${fmtDate(dates[0])} – ${fmtDate(dates[n - 1])}`),
      h('button', { onclick: () => shiftDate(n) }, '›'),
      !dates.includes(T) && h('button', { onclick: () => { ui.date = T; render(); } }, '今日へ')));

    const wrap = h('div', { class: 'linkview' + (n > 1 ? ' multi' : '') });
    const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('class', 'lv-lines' + (n > 1 ? ' thin' : ''));
    const left = h('div', { class: 'lv-left' });
    const right = h('div', { class: 'lv-right' });
    wrap.append(svg, left, right);

    // ---- 左: カレンダー ----
    const timed = perDay.flat().filter(o => o.start != null);
    let startH = 6, endH = 23;
    if (timed.length) {
      startH = Math.min(6, Math.floor(Math.min(...timed.map(o => o.start)) / 60));
      endH = Math.min(24, Math.max(22, Math.ceil(Math.max(...timed.map(o => o.start + (o.dur || 30))) / 60)) + 1);
    }
    const cal = h('div', { class: 'cal n' + n, style: `--n:${n}` });
    const head = h('div', { class: 'cal-row cal-head' }, h('div', { class: 'gut' }));
    dates.forEach(d => head.append(h('div', {
      class: 'dh' + (d === T ? ' today' : '') + (isWe(d) ? ' we' : ''), title: 'この日に追加',
      onclick: () => openDialog(null, { date: d }),
    }, h('small', {}, DOW[C.dowOf(d)]), h('b', {}, String(C.parse(d).getDate())))));
    cal.append(head);

    if (perDay.some(list => list.some(o => o.start == null))) {
      const ur = h('div', { class: 'cal-row cal-untimed' }, h('div', { class: 'gut' }, '未定'));
      dates.forEach((d, i) => {
        const cell = h('div', { class: 'uc' + (isWe(d) ? ' we' : ''), onclick: e => { if (e.target === cell) openDialog(null, { date: d }); } });
        perDay[i].filter(o => o.start == null).forEach(o => cell.append(occRow(o, d, proj)));
        ur.append(cell);
      });
      cal.append(ur);
    }

    const body = h('div', { class: 'cal-row cal-body', style: `height:${(endH - startH) * PX}px` });
    const gut = h('div', { class: 'gut' });
    for (let hr = startH; hr < endH; hr++) gut.append(h('div', { class: 'hl', style: `top:${(hr - startH) * PX}px` }, h('span', {}, `${hr}:00`)));
    body.append(gut);
    dates.forEach((d, i) => {
      const dc = h('div', { class: 'dc' + (d === T ? ' today' : '') + (isWe(d) ? ' we' : ''), 'data-date': d });
      // 位置(clientY) → 時刻(分)。近い15分に丸める
      const yToMin = cy => {
        const y = cy - dc.getBoundingClientRect().top;
        const m = Math.round((startH * 60 + y / PX * 60) / SNAP) * SNAP;
        return Math.max(startH * 60, Math.min(m, 24 * 60 - SNAP));
      };
      let sel = null;
      const showSel = (a, c) => {
        const lo = Math.min(a, c), hi = a === c ? a + 30 : Math.max(a, c);
        if (!sel) { sel = h('div', { class: 'sel' }); dc.append(sel); }
        sel.style.top = `${(lo / 60 - startH) * PX}px`; sel.style.height = `${(hi - lo) / 60 * PX}px`;
        sel.textContent = a === c ? C.fromMin(lo) : `${C.fromMin(lo)}–${C.fromMin(hi)}`;
      };
      const finish = (a, c) => {
        suppressClick = true; setTimeout(() => { suppressClick = false; }, 400);
        const lo = Math.min(a, c), hi = Math.max(a, c);
        openDialog(null, hi - lo >= SNAP ? { date: d, time: C.fromMin(lo), duration: hi - lo } : { date: d, time: C.fromMin(lo) });
      };
      // タップ/クリック: 開始時刻だけ推測して入力
      dc.addEventListener('click', e => {
        if (suppressClick || e.target.closest('.block')) return;
        openDialog(null, { date: d, time: C.fromMin(yToMin(e.clientY)) });
      });
      // マウス: ドラッグで範囲選択
      let drag = null;
      dc.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.block')) return;
        e.preventDefault(); dc.setPointerCapture(e.pointerId);
        drag = { a: yToMin(e.clientY), c: null, moved: false };
      });
      dc.addEventListener('pointermove', e => {
        if (!drag) return;
        drag.c = yToMin(e.clientY);
        if (drag.c !== drag.a) drag.moved = true;
        if (drag.moved) showSel(drag.a, drag.c);
      });
      dc.addEventListener('pointerup', () => {
        const dr = drag; drag = null;
        if (dr && dr.moved) finish(dr.a, dr.c); // 動かしていなければ click に任せる
        else if (sel) { sel.remove(); sel = null; }
      });
      // タッチ: 長押ししてからなぞる（通常のなぞりはスクロール）
      let tch = null;
      dc.addEventListener('touchstart', e => {
        if (e.touches.length !== 1 || e.target.closest('.block')) return;
        const t = e.touches[0];
        tch = { x: t.clientX, y: t.clientY, a: yToMin(t.clientY), c: yToMin(t.clientY), on: false };
        tch.timer = setTimeout(() => { if (tch) { tch.on = true; showSel(tch.a, tch.a); if (navigator.vibrate) navigator.vibrate(15); } }, 350);
      }, { passive: true });
      dc.addEventListener('touchmove', e => {
        if (!tch) return;
        const t = e.touches[0];
        if (!tch.on) { if (Math.hypot(t.clientX - tch.x, t.clientY - tch.y) > 8) { clearTimeout(tch.timer); tch = null; } return; }
        e.preventDefault(); // 長押し後はスクロールさせない
        tch.c = yToMin(t.clientY); showSel(tch.a, tch.c);
      }, { passive: false });
      const tend = () => {
        if (!tch) return;
        clearTimeout(tch.timer);
        const t = tch; tch = null;
        if (t.on) finish(t.a, t.c);
      };
      dc.addEventListener('touchend', tend);
      dc.addEventListener('touchcancel', () => { if (tch) { clearTimeout(tch.timer); tch = null; } if (sel) { sel.remove(); sel = null; } });
      const list = perDay[i].filter(o => o.start != null).sort((a, b) => a.start - b.start);
      layoutColumns(list).forEach(({ o, col, cols }) => {
        const dur = o.dur || 30, it = o.item;
        dc.append(h('div', {
          class: 'block' + (o.done ? ' done' : ''), 'data-id': it.id, 'data-date': d,
          style: `top:${(o.start / 60 - startH) * PX}px;height:${Math.max(dur / 60 * PX - 2, 26)}px;left:calc(${col / cols * 100}% + 1px);width:calc(${100 / cols}% - 2px);--c:${colorFor(it)}`,
        },
          h('input', { type: 'checkbox', checked: o.done, onchange: () => toggleOcc(o, d) }),
          h('div', { class: 'bt', onclick: () => pinOrEdit(it) },
            h('b', {}, it.title),
            h('small', {}, `${C.fromMin(o.start)}${o.dur ? '–' + C.fromMin(o.start + o.dur) : ''}${badge(o, proj)}`))));
      });
      if (d === T) {
        const now = new Date(), m = now.getHours() * 60 + now.getMinutes();
        if (m / 60 >= startH && m / 60 <= endH) dc.append(h('div', { class: 'now', style: `top:${(m / 60 - startH) * PX}px` }));
      }
      body.append(dc);
    });
    cal.append(body);
    left.append(cal, h('p', { class: 'hint' }, '空いている時間をタップすると開始時刻つきで追加。PCはドラッグ、スマホは長押ししてなぞると時間の長さも決められます。日付の見出しをタップすると時間未定で追加。'));

    // ---- 右: WBS（継続作業・習慣）----
    const stripDates = Array.from({ length: STRIP }, (_, i) => C.addDays(start, i));
    const rows = state.items.filter(i => (i.kind === 'series' && !proj[i.id].finished) || i.kind === 'habit');
    if (rows.length) {
      const box = h('div', { class: 'card' }, h('h3', {}, `WBS　${fmtDate(stripDates[0])} から${STRIP}日`));
      for (const it of rows) {
        const p = proj[it.id];
        const sub = it.kind === 'series' ? `残り${C.fmtDur(p.remaining)} / ${C.fmtDur(it.total)}` : `🔥 ${C.streak(it, T)}日連続`;
        const eta = it.kind === 'series' ? (p.end ? `完了予定 ${fmtDate(p.end)}` : '') : '';
        const strip = h('div', { class: 'strip' });
        stripDates.forEach((d, i) => {
          const o = C.occurrences([it], d, T, proj).find(x => x.item === it);
          strip.append(h('div', {
            class: 'c' + (i < n ? ' inview' : '') + (isWe(d) ? ' we' : ''), 'data-cell': `${it.id}|${d}`,
            title: `${fmtDate(d)}${o && o.planned ? ' ' + C.fmtDur(o.planned) : ''}`,
            onclick: ev => { ev.stopPropagation(); ui.date = d; render(); },
          }, h('span', { class: 'dn' }, String(C.parse(d).getDate())),
            o && h('i', { class: 'm ' + it.kind + (o.done ? ' done' : '') + (it.kind === 'series' && p.end === d ? ' last' : '') })));
        });
        box.append(h('div', { class: 'srow', 'data-id': it.id, style: `--c:${colorFor(it)}` },
          h('div', { class: 'sh' }, h('div', { class: 'sname', onclick: () => openDialog(it) }, h('b', {}, it.title), h('small', {}, sub)),
            h('span', { class: 'eta' }, eta)),
          strip));
      }
      right.append(box);
    }

    // ---- 右: TODO（単発タスク）----
    const tasks = state.items.filter(i => i.kind === 'task' && (!i.done || dates.includes(i.date)))
      .sort((a, b) => (a.done - b.done) || (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '').localeCompare(b.time || ''));
    const tbox = h('div', { class: 'card' }, h('h3', {}, `TODO（${tasks.filter(t => !t.done).length}）`));
    if (!tasks.length) tbox.append(h('p', { class: 'empty small' }, '単発タスクはありません'));
    for (const t of tasks) {
      const o = { item: t, done: t.done };
      const meta = [t.date ? fmtDate(t.date) : 'いつでも', t.time, t.duration && C.fmtDur(t.duration), t.date && t.date < T && !t.done && '期限切れ'].filter(Boolean).join(' ・ ');
      tbox.append(h('div', { class: 'row-item' + (t.done ? ' done' : '') + (dates.includes(t.date) ? ' onday' : ''), 'data-id': t.id, 'data-todo': t.id, style: `--c:${colorFor(t)}` },
        h('input', { type: 'checkbox', checked: t.done, onchange: () => toggleOcc(o, t.date || T) }),
        h('div', { class: 'grow', onclick: () => openDialog(t) }, h('b', {}, t.title), h('small', {}, meta))));
    }
    right.append(tbox);

    // ハイライトのイベント
    wrap.addEventListener('mouseover', e => {
      if (ui.pin) return;
      const t = e.target.closest('[data-id]');
      setFocus(t ? t.dataset.id : null);
    });
    wrap.addEventListener('mouseleave', () => { if (!ui.pin) setFocus(null); });
    wrap.addEventListener('click', e => { if (!e.target.closest('[data-id]')) { ui.pin = null; setFocus(null); } });
    root.append(wrap);
    requestAnimationFrame(() => { drawLines(); if (ui.pin && wrap.querySelector(`[data-id="${ui.pin}"]`)) setFocus(ui.pin); else ui.pin = null; });
  }

  function setFocus(id) {
    const wrap = $('#view-day .linkview'); if (!wrap) return;
    wrap.classList.toggle('has-focus', !!id);
    wrap.querySelectorAll('[data-id]').forEach(e => e.classList.toggle('hl', !!id && e.dataset.id === id));
  }
  function pinOrEdit(it) {
    if (ui.pin === it.id) { openDialog(it); return; }
    ui.pin = it.id; setFocus(it.id);
  }
  /** 左の予定 → 右のWBSの該当日のマス / TODO行 へ曲線を引く */
  function drawLines() {
    const wrap = $('#view-day .linkview'); if (!wrap) return;
    const svg = wrap.querySelector('.lv-lines'); svg.replaceChildren();
    if (getComputedStyle(svg).display === 'none') return;
    const wr = wrap.getBoundingClientRect();
    svg.setAttribute('width', wr.width); svg.setAttribute('height', wr.height);
    for (const el of wrap.querySelectorAll('.lv-left [data-id]')) {
      const id = el.dataset.id;
      const tgt = wrap.querySelector(`.lv-right [data-todo="${id}"], .lv-right [data-cell="${id}|${el.dataset.date}"]`);
      if (!tgt) continue;
      const a = el.getBoundingClientRect(), b = tgt.getBoundingClientRect();
      if (!a.height) continue;
      const x1 = a.right - wr.left, y1 = a.top - wr.top + Math.min(a.height / 2, 16);
      const x2 = b.left - wr.left, y2 = b.top - wr.top + b.height / 2;
      const dx = Math.max(30, (x2 - x1) / 2);
      const color = getComputedStyle(el).getPropertyValue('--c').trim() || '#4f7cff';
      const path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`);
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', color);
      path.setAttribute('data-id', id);
      const dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('cx', x2); dot.setAttribute('cy', y2); dot.setAttribute('r', 4);
      dot.setAttribute('fill', color); dot.setAttribute('data-id', id);
      svg.append(path, dot);
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
  function occRow(o, date, proj) {
    const it = o.item;
    const extra = it.kind === 'series' ? `${C.fmtDur(o.planned)}${badge(o, proj)}`
      : [o.dur && C.fmtDur(o.dur), o.overdue && `期限切れ(${fmtDate(it.date)})`].filter(Boolean).join(' ・ ');
    return h('div', { class: 'row-item' + (o.done ? ' done' : ''), 'data-id': it.id, 'data-date': date, style: `--c:${colorFor(it)}` },
      h('input', { type: 'checkbox', checked: o.done, onchange: () => toggleOcc(o, date) }),
      h('div', { class: 'grow', onclick: () => pinOrEdit(it) }, h('b', {}, it.title), h('small', {}, extra)));
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
      onclick: () => { ui.date = d; ui.pin = null; ui.tab = 'day'; render(); },
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
        h('button', { onclick: setupWeather }, '天気の地点を設定'),
        h('button', { onclick: () => forceUpdate() }, '最新に更新')),
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

  function openDialog(item, preset) {
    ui.editing = item || null;
    form.reset();
    $('#dlgTitle').textContent = item ? '編集' : preset ? `追加　${fmtDate(preset.date)}${preset.time ? ' ' + preset.time + (preset.duration ? '–' + C.fromMin(C.toMin(preset.time) + preset.duration) : '') : ''}` : '追加';
    $('#delBtn').hidden = !item;
    $('#kindSeg').hidden = !!item;
    const all = [0, 1, 2, 3, 4, 5, 6];
    dayChips($('#daysSeries'), item && item.kind === 'series' ? item.days : all);
    dayChips($('#daysHabit'), item && item.kind === 'habit' ? item.days : all);
    form.startDate.value = today();
    let kind = item ? item.kind : 'task';
    if (item) {
      form.title.value = item.title || '';
      form.note.value = item.note || '';
      if (kind === 'task') { form.date.value = item.date || ''; form.time.value = item.time || ''; form.duration.value = item.duration || ''; }
      if (kind === 'series') { form.totalH.value = item.total / 60; form.perDay.value = item.perDay; form.startDate.value = item.startDate || today(); form.stime.value = item.time || ''; }
      if (kind === 'habit') { form.htime.value = item.time || ''; form.hduration.value = item.duration || ''; }
      if (kind === 'memo') form.text.value = item.text || '';
    } else if (preset) {
      form.date.value = form.startDate.value = preset.date;
      form.time.value = form.stime.value = form.htime.value = preset.time || '';
      if (preset.duration) form.duration.value = form.perDay.value = form.hduration.value = preset.duration;
    }
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
  let raf = 0; const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => ui.tab === 'day' && drawLines()); };
  window.addEventListener('resize', redraw); window.addEventListener('scroll', redraw, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  setInterval(() => { if (ui.tab === 'day') render(); }, 60000);
  render(); loadWeather();
  // ---------- 自動更新 ----------
  // 新しい版が見つかったら再読み込み（入力画面を開いている間は閉じるまで待つ）
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    const reload = () => { if (reloading) return; reloading = true; location.reload(); };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return; // 初回インストールでは再読み込みしない
      if (dlg.open) dlg.addEventListener('close', reload, { once: true }); else reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      setInterval(check, 10 * 60 * 1000);
    }).catch(() => {});
  }
  async function forceUpdate() {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
      for (const k of await caches.keys()) await caches.delete(k);
    } catch (e) { /* ignore */ }
    location.reload();
  }
})();
