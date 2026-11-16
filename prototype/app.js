(() => {
  'use strict';
  const D = window.PN;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ts = (s) => +new Date(s);
  const H = 3600e3, DAY = 24 * H;
  const NOW = ts(D.now), LAST = ts(D.lastNote);
  const pad2 = (n) => String(n).padStart(2, '0');
  const md = (t) => { const d = new Date(t); return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`; };
  const hm = (t) => { const d = new Date(t); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
  const dayNo = (start, at = NOW) => Math.round((dayStart(at) - dayStart(ts(start))) / DAY) + 1;
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
  const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const WEEK = '日一二三四五六';

  /* ================= 插入 note ================= */
  const INS = [];
  /** 產生一顆「插入」按鈕；text 可以是字串，或按下時才算的函式 */
  function insBtn(text, label, withText) {
    INS.push({ text, label });
    const cls = withText ? 'ib ib-text' : 'ib';
    return `<button class="${cls}" type="button" data-ins="${INS.length - 1}" title="插入 note：${esc(label)}" aria-label="插入 note：${esc(label)}">${icon('insert')}${withText ? esc(withText) : ''}</button>`;
  }

  const note = $('#note');
  const statusEl = $('#status');
  const editor = $('.editor');
  let caret = { s: 0, e: 0 };
  const saveCaret = () => { caret = { s: note.selectionStart, e: note.selectionEnd }; };
  let sayTimer = 0;
  function say(msg, done) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('done', !!done);
    clearTimeout(sayTimer);
    if (done) sayTimer = setTimeout(() => statusEl.classList.remove('done'), 2600);
  }
  function flash() {
    editor.classList.remove('flash');
    void editor.offsetWidth;
    editor.classList.add('flash');
  }
  /** 用 execCommand 寫入，Ctrl+Z 才復原得回來 */
  function typeInto(s, e, text) {
    note.focus();
    note.setSelectionRange(s, e);
    if (!document.execCommand('insertText', false, text)) note.setRangeText(text, s, e, 'end');
    saveCaret();
    afterEdit();
  }
  function insertAtCaret(text, label) {
    const v = note.value;
    let t = text;
    const before = v.slice(0, caret.s), after = v.slice(caret.e);
    if (before && !before.endsWith('\n')) t = '\n' + t;
    if (after && !after.startsWith('\n')) t += '\n';
    typeInto(caret.s, caret.e, t);
    flash();
    say(`已插入：${label}（Ctrl+Z 可復原）`, true);
  }
  function replaceAll(next, label, focusMarker) {
    typeInto(0, note.value.length, next);
    if (focusMarker) jumpTo(focusMarker, true);
    flash();
    say(label, true);
  }

  /** 量出第 idx 個字元在 textarea 裡的垂直位置（考慮自動換行） */
  let mirror;
  function topOf(idx) {
    if (!mirror) {
      mirror = document.createElement('div');
      mirror.setAttribute('aria-hidden', 'true');
      mirror.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;white-space:pre-wrap;overflow-wrap:break-word;';
      document.body.appendChild(mirror);
    }
    const cs = getComputedStyle(note);
    mirror.style.font = cs.font;
    mirror.style.lineHeight = cs.lineHeight;
    mirror.style.padding = cs.padding;
    mirror.style.width = note.clientWidth + 'px';
    mirror.textContent = note.value.slice(0, idx);
    const mark = document.createElement('span');
    mark.textContent = '​';
    mirror.appendChild(mark);
    return mark.offsetTop;
  }
  function jumpTo(marker, quiet) {
    const i = note.value.indexOf(marker);
    if (i < 0) { say(`這篇 note 沒有 ${marker} 段落`); return; }
    const eol = note.value.indexOf('\n', i);
    const pos = eol < 0 ? note.value.length : eol + 1;
    note.focus();
    note.setSelectionRange(pos, pos);
    note.scrollTop = Math.max(0, topOf(i) - 14);
    saveCaret();
    if (!quiet) say(`游標移到 ${marker} 下一行`);
  }

  function afterEdit() {
    const v = note.value;
    $('#count').textContent = `${v.length} 字 · ${v.split('\n').length} 行`;
    if (!$('#edPrev').hidden) renderPrev();
  }
  function renderPrev() {
    const cur = new Set(note.value.split('\n').map((l) => l.trim()));
    $('#prevBody').innerHTML = D.prevNote.split('\n')
      .map((l) => `<span class="${l.trim() && !cur.has(l.trim()) ? 'chg' : ''}">${esc(l) || ' '}</span>`).join('');
  }

  /* ================= 病人列 ================= */
  function renderBar() {
    const p = D.patient;
    $('#pBed').textContent = p.bed;
    $('#pSeq').textContent = p.seq;
    $('#pId').innerHTML = `<b>${esc(p.name)}</b><span>${p.age} 歲 ${esc(p.sex)} · ${esc(p.chart)}</span>`;
    const facts = [
      ['住院', `D${dayNo(p.admitted)}`], ['診斷', p.dx], ['主治', p.vs],
      ['過敏', p.allergy], ['氧氣', p.o2], ['飲食', p.diet],
    ];
    $('#pFacts').innerHTML = facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  }

  /* ================= 時間軸 ================= */
  const TL = { range: 72, compact: false, dayHi: null };
  const LANES = D.abx.filter((a) => (a.end ? ts(a.end) : NOW) > NOW - 168 * H);
  const ROWS = [
    { id: 't', h: 44 }, { id: 'hr', h: 26 }, { id: 'bp', h: 28 }, { id: 'sp', h: 22 },
    { id: 'io', h: 38 }, { id: 'wt', h: 22 }, { id: 'abx', h: LANES.length * 17 + 6 }, { id: 'cx', h: 24 },
  ];
  const AXIS_H = 20;
  const lastV = D.vitals[D.vitals.length - 1];
  let geo = null;

  function drawTimeline() {
    const rows = ROWS.filter((r) => !TL.compact || ['t', 'abx', 'cx'].includes(r.id));
    const W = $('#tlPlot').clientWidth;
    const t0 = NOW - TL.range * H, t1 = NOW + TL.range * H * 0.012;
    const x = (t) => ((t - t0) / (t1 - t0)) * W;
    const Y = {};
    let y = 0;
    rows.forEach((r) => { Y[r.id] = { y, h: r.h }; y += r.h; });
    const bodyH = y, total = y + AXIS_H;
    const vit = D.vitals.filter((v) => v.t >= t0 - 4 * H && v.t <= t1);
    const inWin = D.vitals.filter((v) => v.t >= t0 && v.t <= t1);
    const f = (n) => n.toFixed(1);
    let s = `<defs><clipPath id="tlClip"><rect x="0" y="0" width="${W}" height="${bodyH}"/></clipPath></defs>`;

    // 上一篇 note 之後的區段：全頁同一個底色語彙
    const xs = Math.max(0, x(LAST));
    s += `<rect class="tl-since" x="${f(xs)}" y="0" width="${f(W - xs)}" height="${bodyH}"/>`;

    // 日界線與時間刻度
    for (let d = dayStart(t0); d <= t1; d += DAY) {
      if (d >= t0) s += `<line class="tl-day" x1="${f(x(d))}" x2="${f(x(d))}" y1="0" y2="${total}"/>`;
      const a = Math.max(d, t0), b = Math.min(d + DAY, t1);
      if (b - a > DAY * 0.22 || TL.range > 24) {
        const wd = WEEK[new Date(d).getDay()];
        const lab = TL.range >= 168 ? md(d) : `${md(d)}（${wd}）`;
        if (x(b) - x(a) > 54) s += `<text x="${f((x(a) + x(b)) / 2)}" y="${total - 6}" text-anchor="middle">${lab}</text>`;
      }
      if (TL.range <= 72) {
        const step = TL.range <= 24 ? 4 : 12;
        for (let h = step; h < 24; h += step) {
          const tt = d + h * H;
          if (tt <= t0 || tt >= t1) continue;
          s += `<line class="tl-tick" x1="${f(x(tt))}" x2="${f(x(tt))}" y1="0" y2="${bodyH}"/>`;
          if (TL.range <= 24) s += `<text x="${f(x(tt) + 3)}" y="${bodyH - 3}">${pad2(h)}:00</text>`;
        }
      }
    }
    rows.forEach((r, i) => { if (i) s += `<line class="tl-sep" x1="0" x2="${W}" y1="${Y[r.id].y}" y2="${Y[r.id].y}"/>`; });
    s += `<line class="tl-day" x1="0" x2="${W}" y1="${bodyH}" y2="${bodyH}"/>`;
    if (xs > 0 && W - xs > 96) s += `<text class="since" x="${f(xs + 5)}" y="11">上一篇之後</text>`;

    s += '<g clip-path="url(#tlClip)">';
    const scale = (row, lo, hi, padTop = 5, padBot = 5) => (v) => row.y + padTop + ((hi - v) / (hi - lo)) * (row.h - padTop - padBot);
    const poly = (pts, cls) => `<polyline class="tl-line ${cls}" points="${pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' ')}"/>`;

    // 體溫
    if (Y.t) {
      const yt = scale(Y.t, 35.9, 39.1, 13, 5);
      s += `<line class="tl-thr" x1="0" x2="${W}" y1="${f(yt(38))}" y2="${f(yt(38))}"/>`;
      s += poly(vit.map((v) => [x(v.t), yt(v.temp)]), 't');
      const tmax = inWin.reduce((m, v) => (v.temp > (m ? m.temp : 0) ? v : m), null);
      vit.forEach((v) => {
        const hot = v.temp >= 38;
        s += `<circle class="tl-dot t ${hot ? 'hi' : ''}" cx="${f(x(v.t))}" cy="${f(yt(v.temp))}" r="${hot ? 3.4 : 2.4}"/>`;
        if (hot || v === tmax) s += `<text class="${hot ? 'hi' : 'val'}" x="${f(x(v.t))}" y="${f(yt(v.temp) - 6)}" text-anchor="middle">${v.temp.toFixed(1)}</text>`;
      });
      s += `<text x="${W - 4}" y="${f(yt(38) - 3)}" text-anchor="end">38</text>`;
    }
    if (Y.hr) {
      const yh = scale(Y.hr, 55, 125);
      s += poly(vit.map((v) => [x(v.t), yh(v.hr)]), '');
      vit.forEach((v) => { if (v.hr >= 100) s += `<circle class="tl-dot hi" cx="${f(x(v.t))}" cy="${f(yh(v.hr))}" r="2.6"/>`; });
    }
    if (Y.bp) {
      const yb = scale(Y.bp, 45, 150, 4, 4);
      vit.forEach((v) => { s += `<line class="tl-bp" x1="${f(x(v.t))}" x2="${f(x(v.t))}" y1="${f(yb(v.sys))}" y2="${f(yb(v.dia))}"/>`; });
    }
    if (Y.sp) {
      const ysp = scale(Y.sp, 88, 100, 4, 4);
      s += poly(vit.map((v) => [x(v.t), ysp(v.spo2)]), '');
      vit.forEach((v) => {
        if (v.spo2 < 94) s += `<circle class="tl-dot lo" cx="${f(x(v.t))}" cy="${f(ysp(v.spo2))}" r="2.8"/><text class="val" x="${f(x(v.t) + 6)}" y="${f(ysp(v.spo2) + 2)}">${v.spo2}</text>`;
      });
    }
    // I/O：每天一組長條，上面標淨值
    if (Y.io) {
      const r = Y.io, base = r.y + r.h - 3, maxH = r.h - 17;
      D.io.forEach((d) => {
        const ds = ts(d.d + 'T00:00:00');
        const a = Math.max(ds, t0), b = Math.min(ds + DAY, NOW);
        if (b - a < 2 * H) return;
        const cx = (x(a) + x(b)) / 2, bw = Math.min(16, Math.max(5, (x(b) - x(a)) * 0.16));
        const inp = d.po + d.iv, out = d.urine, net = inp - out;
        const hh = (n) => Math.max(1, (n / 2600) * maxH);
        s += `<rect class="tl-in" x="${f(cx - bw - 1)}" y="${f(base - hh(inp))}" width="${f(bw)}" height="${f(hh(inp))}"/>`;
        s += `<rect class="tl-out" x="${f(cx + 1)}" y="${f(base - hh(out))}" width="${f(bw)}" height="${f(hh(out))}"/>`;
        if (x(b) - x(a) > 40) s += `<text class="net ${net < 0 ? 'neg' : ''}" x="${f(cx + bw + 6)}" y="${f(base - 2)}">${signed(net)}${d.partial ? '*' : ''}</text>`;
      });
    }
    if (Y.wt) {
      const r = Y.wt;
      D.io.forEach((d) => {
        const tw = ts(d.d + 'T06:00:00');
        if (tw < t0 || tw > t1) return;
        s += `<circle class="tl-dot" cx="${f(x(tw))}" cy="${r.y + r.h / 2}" r="2.4"/><text class="val" x="${f(x(tw) + 6)}" y="${r.y + r.h / 2 + 4}">${d.wt.toFixed(1)}</text>`;
      });
    }
    // 抗生素日程
    if (Y.abx) {
      LANES.forEach((a, i) => {
        const a0 = Math.max(ts(a.start), t0), a1 = Math.min(a.end ? ts(a.end) : NOW, t1);
        if (a1 <= a0) return;
        const yy = Y.abx.y + 4 + i * 17, x0 = x(a0), w = x(a1) - x0;
        s += `<rect class="tl-abx ${a.end ? 'ended' : i % 2 ? 'alt' : ''}" x="${f(x0)}" y="${yy}" width="${f(w)}" height="13" rx="2"/>`;
        const label = a.end ? `${a.name} ${md(ts(a.start))}–${md(ts(a.end))}` : `${a.name} · D${dayNo(a.start)}`;
        if (w > label.length * 6.4 + 12) s += `<text class="abx" x="${f(x0 + 6)}" y="${yy + 10}">${esc(label)}</text>`;
        else if (w > 30) s += `<text class="abx" x="${f(x0 + 6)}" y="${yy + 10}">D${dayNo(a.start)}</text>`;
      });
    }
    // 培養送檢點：同一個時段送的合成一個標記
    if (Y.cx) {
      const groups = new Map();
      D.cultures.filter((c) => ts(c.t) >= t0 && ts(c.t) <= t1).forEach((c) => {
        const key = Math.round(ts(c.t) / (3 * H));
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      });
      const rank = { grown: 0, pending: 1, ng: 2 };
      [...groups.values()].forEach((list) => {
        list.sort((a, b) => rank[a.status] - rank[b.status]);
        const cx = x(ts(list[0].t)), yy = Y.cx.y + 6;
        const label = list.map((c) => `<tspan class="${c.status}">${esc(c.spec)}${c.n > 1 ? '×' + c.n : ''}</tspan>`).join('<tspan> · </tspan>');
        const flip = cx > W - 150;
        s += `<g class="tl-cx ${list[0].status}" data-cx="${list[0].id}" tabindex="0" role="button" aria-label="跳到 ${md(ts(list[0].t))} 的培養">` +
          `<path d="M${f(cx - 5)},${yy} L${f(cx + 5)},${yy} L${f(cx)},${yy + 10} Z"/>` +
          `<text x="${f(flip ? cx - 9 : cx + 9)}" y="${yy + 10}" text-anchor="${flip ? 'end' : 'start'}">${label}</text></g>`;
      });
    }
    s += '</g>';
    s += `<rect class="tl-dayhi" id="tlDayHi" y="0" height="${bodyH}" width="0"/>`;
    s += `<line class="tl-cross" id="tlCross" y1="0" y2="${bodyH}" x1="-10" x2="-10"/>`;

    const svg = $('#tlSvg');
    svg.setAttribute('viewBox', `0 0 ${W} ${total}`);
    svg.setAttribute('height', total);
    svg.innerHTML = s;
    geo = { W, t0, t1, x, bodyH };
    drawLegend(rows, inWin);
    if (TL.dayHi) highlightDay(TL.dayHi);
  }

  function drawLegend(rows, win) {
    const rng = (k) => { const a = win.map((v) => v[k]); return a.length ? [Math.min(...a), Math.max(...a)] : [0, 0]; };
    const tR = rng('temp'), hR = rng('hr'), sR = rng('spo2');
    const today = D.io[D.io.length - 1], yest = D.io[D.io.length - 2];
    const net = (d) => d.po + d.iv - d.urine;
    const pend = D.cultures.filter((c) => c.status === 'pending').reduce((n, c) => n + c.n, 0);
    const rangeLabel = TL.range === 24 ? '近 24 小時' : TL.range === 72 ? '近 3 天' : '近 7 天';
    const vsText = () => {
      const wts = D.io.slice(-4).map((d) => d.wt.toFixed(1)).join('>');
      return `T: ${lastV.temp.toFixed(1)} °C P: ${lastV.hr} bpm R: ${lastV.rr} /min\nBP: ${lastV.sys}/${lastV.dia} mmHg\n體重:${wts}(${md(NOW)})`;
    };
    const html = {
      t: `<span class="n">體溫</span><span class="v ${lastV.temp >= 38 ? 'hi' : ''}">${lastV.temp.toFixed(1)}</span><span class="s">Tmax ${tR[1].toFixed(1)}</span>${insBtn(vsText, '[V/S] 最後一筆與體重趨勢')}`,
      hr: `<span class="n">心跳</span><span class="v">${lastV.hr}</span><span class="s">${hR[0]}–${hR[1]} bpm</span>`,
      bp: `<span class="n">血壓</span><span class="v">${lastV.sys}/${lastV.dia}</span><span class="s">mmHg</span>`,
      sp: `<span class="n">SpO₂</span><span class="v ${lastV.spo2 < 94 ? 'lo' : ''}">${lastV.spo2}%</span><span class="s">最低 ${sR[0]}% · RR ${lastV.rr}</span>`,
      io: `<span class="n">I/O</span><span class="v ${net(yest) < 0 ? 'lo' : ''}">${signed(net(yest))}</span><span class="s">昨日 · 今日 ${signed(net(today))}*</span>`,
      wt: `<span class="n">體重</span><span class="v">${today.wt.toFixed(1)}</span><span class="s">kg · 較昨日 ${signed(+(today.wt - yest.wt).toFixed(1))}</span>`,
      abx: LANES.map((a) => `<div><b>${esc(a.name)}</b><span class="s">${a.end ? '已停' : 'D' + dayNo(a.start)}</span></div>`).join(''),
      cx: `<span class="n">培養</span><span class="v ${pend ? '' : ''}">${pend} 管</span><span class="s">未發報告</span>`,
    };
    $('#tlLegend').innerHTML = rows.map((r) => `<div class="tl-leg ${r.id === 'abx' ? 'abx' : ''}" style="height:${r.h}px">${html[r.id]}</div>`).join('') +
      `<div class="tl-leg axis" style="height:${AXIS_H}px"><span>${rangeLabel}</span><span>* 今日至 08:00</span></div>`;
  }

  function highlightDay(label) {
    TL.dayHi = label;
    const el = $('#tlDayHi');
    if (!el || !geo) return;
    if (!label) { el.setAttribute('width', 0); return; }
    const [m, d] = label.split('/').map(Number);
    const ds = +new Date(new Date(NOW).getFullYear(), m - 1, d);
    const a = Math.max(ds, geo.t0), b = Math.min(ds + DAY, geo.t1);
    if (b <= a) { el.setAttribute('width', 0); return; }
    el.setAttribute('x', geo.x(a));
    el.setAttribute('width', geo.x(b) - geo.x(a));
  }

  function bindTimeline() {
    const plot = $('#tlPlot'), read = $('#tlRead');
    plot.addEventListener('mousemove', (e) => {
      if (!geo) return;
      const box = plot.getBoundingClientRect();
      const px = e.clientX - box.left;
      const t = geo.t0 + (px / geo.W) * (geo.t1 - geo.t0);
      let best = null;
      for (const v of D.vitals) if (!best || Math.abs(v.t - t) < Math.abs(best.t - t)) best = v;
      if (!best || best.t < geo.t0) { read.hidden = true; return; }
      const cx = geo.x(best.t);
      const cross = $('#tlCross');
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx);
      const on = D.abx.filter((a) => ts(a.start) <= best.t && (!a.end || ts(a.end) > best.t))
        .map((a) => `${esc(a.name)} D${dayNo(a.start, best.t)}`).join('、') || '無';
      read.innerHTML = `<b>${md(best.t)} ${hm(best.t)}</b><hr>` +
        `<div><span class="k">體溫</span><span class="${best.temp >= 38 ? 'hot' : ''}">${best.temp.toFixed(1)} °C</span></div>` +
        `<div><span class="k">心跳</span>${best.hr} bpm</div>` +
        `<div><span class="k">血壓</span>${best.sys}/${best.dia} mmHg</div>` +
        `<div><span class="k">呼吸</span>${best.rr} /min</div>` +
        `<div><span class="k">SpO₂</span><span class="${best.spo2 < 94 ? 'hot' : ''}">${best.spo2}%</span></div><hr>` +
        `<div><span class="k">抗生素</span>${on}</div>`;
      read.hidden = false;
      const rw = read.offsetWidth;
      read.style.left = (cx + 14 + rw > geo.W ? cx - rw - 14 : cx + 14) + 'px';
    });
    plot.addEventListener('mouseleave', () => {
      read.hidden = true;
      const cross = $('#tlCross');
      if (cross) { cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); }
    });
    const go = (e) => {
      const g = e.target.closest('.tl-cx');
      if (!g) return;
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      focusRow('cx-' + g.dataset.cx);
    };
    plot.addEventListener('click', go);
    plot.addEventListener('keydown', go);
    new ResizeObserver(() => drawTimeline()).observe(plot);
  }

  function focusRow(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash-row');
    void el.offsetWidth;
    el.classList.add('flash-row');
  }

  /* ================= 第一欄：變動、用藥、I/O、管路 ================= */
  function renderCol1() {
    const ch = D.changes;
    const allChanges = () => ch.map((c) => c.ins).join('\n');
    let h = `<section class="sec"><div class="sec-h"><h2>自上一篇以來</h2><span class="meta">${md(LAST)} ${hm(LAST)} 之後 · ${ch.length} 項</span><span class="sp"></span>${insBtn(allChanges, '全部變動（英文敘述）', '全部')}</div><ul>`;
    h += ch.map((c) => `<li class="row"><span class="tag ${c.cls}">${c.kind}</span><span class="main">${esc(c.text)}</span><span class="sub">${esc(c.at)}</span>${insBtn(c.ins, c.text)}</li>`).join('');
    h += '</ul></section>';

    const active = D.abx.filter((a) => !a.end), ended = D.abx.filter((a) => a.end);
    const abxLine = (a) => (a.end ? `${a.name} ${md(ts(a.start))}-${md(ts(a.end))}` : `${a.name} ${md(ts(a.start))}- (D${dayNo(a.start)})`);
    const abxBlock = () => [...ended, ...active].sort((a, b) => ts(a.start) - ts(b.start)).map(abxLine).join('\n');
    const nMeds = active.length + D.meds.reduce((n, g) => n + g.items.length, 0);
    h += `<section class="sec"><div class="sec-h"><h2>目前用藥</h2><span class="meta">${nMeds} 項 · 取自今日給藥紀錄</span><span class="sp"></span>${insBtn(abxBlock, '[Abx] 全部日程', 'Abx')}</div>`;
    h += '<div class="grp">抗生素</div><ul>';
    h += active.map((a) => `<li class="row"><span class="tag day">D${dayNo(a.start)}</span><span class="main"><b>${esc(a.name)}</b> <span class="dose">${esc(a.dose)}</span></span><span class="sub">${md(ts(a.start))} 起${ts(a.start) > LAST ? '<i class="dot-new" title="上一篇之後才開始"></i>' : ''}</span>${insBtn(abxLine(a), a.name)}</li>`).join('');
    h += ended.map((a) => `<li class="row"><span class="tag">已停</span><span class="main dose">${esc(a.name)} ${esc(a.dose)}</span><span class="sub">${md(ts(a.start))}–${md(ts(a.end))}</span>${insBtn(abxLine(a), a.name)}</li>`).join('');
    h += '</ul>';
    D.meds.forEach((g) => {
      h += `<div class="grp">${esc(g.g)}</div><ul>`;
      h += g.items.map((m) => {
        const tag = m.flag ? `<span class="tag ${m.flag === '新增' ? 'new' : 'edit'}">${m.flag}</span>` : '';
        const given = m.given ? `<span class="tag ${m.given.length ? 'prn' : ''}" title="${esc(m.given.join('、') || '上一篇之後沒有給')}">給 ${m.given.length} 次</span>` : '';
        const line = `${m.name} ${m.dose}`;
        return `<li class="row">${tag}${given}<span class="main"><b>${esc(m.name)}</b> <span class="dose">${esc(m.dose)}${m.note ? '（' + esc(m.note) + '）' : ''}</span></span><span class="sub">${m.since} 起</span>${insBtn(line, m.name)}</li>`;
      }).join('');
      h += '</ul>';
    });
    h += '</section>';

    const io = D.io.slice(-4);
    const net = (d) => d.po + d.iv - d.urine;
    const ioText = () => io.map((d) => `I/O ${md(ts(d.d + 'T00:00:00'))}${d.partial ? ' (till 08:00)' : ''}: ${d.po + d.iv}/${d.urine} (${net(d) > 0 ? '+' : ''}${net(d)})`).join('\n');
    const cell = (fn, cls = '') => io.map((d) => `<td class="${ts(d.d + 'T23:59:00') > LAST ? 'since' : ''} ${cls && fn(d) < 0 ? cls : ''}">${typeof fn(d) === 'number' && cls ? signed(fn(d)) : fn(d)}</td>`).join('');
    h += `<section class="sec"><div class="sec-h"><h2>I/O 與體重</h2><span class="meta">mL · 不必再進總表勾類別</span><span class="sp"></span>${insBtn(ioText, 'I/O 4 天')}</div>`;
    h += `<table class="io"><colgroup><col><col style="width:62px"><col style="width:62px"><col style="width:62px"><col style="width:74px"></colgroup><thead><tr><th></th>${io.map((d) => `<th class="${ts(d.d + 'T23:59:00') > LAST ? 'since' : ''}">${md(ts(d.d + 'T00:00:00'))}${d.partial ? ` <small title="${esc(d.partial)}">*</small>` : ''}</th>`).join('')}</tr></thead><tbody>`;
    h += `<tr class="tot"><td>Input</td>${cell((d) => d.po + d.iv)}</tr>`;
    h += `<tr class="part"><td>口服與管灌</td>${cell((d) => d.po)}</tr><tr class="part"><td>靜脈輸液</td>${cell((d) => d.iv)}</tr>`;
    h += `<tr class="tot"><td>Output</td>${cell((d) => d.urine)}</tr>`;
    h += `<tr class="part"><td>尿量</td>${cell((d) => d.urine)}</tr><tr class="part"><td>排便次數</td>${cell((d) => d.stool)}</tr>`;
    h += `<tr class="net"><td>Net</td>${cell(net, 'neg')}</tr>`;
    h += `<tr><td>體重 <small>kg</small></td>${cell((d) => d.wt.toFixed(1))}</tr></tbody></table></section>`;

    h += `<section class="sec"><div class="sec-h"><h2>管路</h2><span class="meta">${D.lines.length} 條</span></div><ul>`;
    h += D.lines.map((l) => `<li class="row"><span class="tag">D${dayNo(l.since + 'T00:00:00')}</span><span class="main">${esc(l.name)}</span><span class="sub">${md(ts(l.since + 'T00:00:00'))} 起</span>${insBtn(`${l.name.replace(/（.*）/, '')} since ${md(ts(l.since + 'T00:00:00'))} (D${dayNo(l.since + 'T00:00:00')})`, l.name)}</li>`).join('');
    h += '</ul></section>';
    $('#col1').innerHTML = h;
  }

  /* ================= 第二欄：Lab ================= */
  const L = D.labs;
  const COLW = 50, DELTAW = 46, INSW = 26;
  const NEW_IDX = L.cols.map((_, i) => i).filter((i) => L.cols[i].d > L.lastNoteDay);
  const stateOf = (r, v) => {
    if (v == null || v === 'pending') return '';
    const n = parseFloat(v);
    return n > r.hi ? 'hi' : n < r.lo ? 'lo' : '';
  };
  function renderLab() {
    const nCols = L.cols.length;
    let h = `<section class="sec"><div class="sec-h"><h2>Lab</h2><span class="meta">近 ${nCols} 天 · 點項目名稱看趨勢</span><span class="sp"></span><button class="ib ib-text" type="button" id="btnLabMerge" title="把上一篇之後的新日期補進 note 的 [Lab] 表格">${icon('insert')}補進 [Lab]</button></div>`;
    h += `<div class="lab-tools"><span class="meta">上一篇的 [Lab] 到 ${L.lastNoteDay}，新日期：${NEW_IDX.map((i) => L.cols[i].d).join('、') || '無'}</span><button class="btn btn-sm" type="button" id="btnAbn" aria-pressed="false">只看異常</button></div>`;
    h += `<table class="lab"><colgroup><col>${L.cols.map(() => `<col style="width:${COLW}px">`).join('')}<col style="width:${DELTAW}px"><col style="width:${INSW}px"></colgroup>`;
    h += `<thead><tr><th>項目</th>${L.cols.map((c, i) => `<th class="${NEW_IDX.includes(i) ? 'since' : ''}" data-day="${c.d}">${c.d}</th>`).join('')}<th>Δ</th><th></th></tr>`;
    h += `<tr><th></th>${L.cols.map((c, i) => `<th class="${NEW_IDX.includes(i) ? 'since' : ''}" data-day="${c.d}">${c.t}</th>`).join('')}<th></th><th></th></tr></thead><tbody>`;
    L.groups.forEach((g, gi) => {
      const tbl = () => D.fmtTable(g, NEW_IDX.length ? NEW_IDX : [nCols - 1]);
      const hasNew = g.rows.some((r) => NEW_IDX.some((i) => r.v[i] != null));
      h += `<tr class="g" data-g="${gi}"><td colspan="${nCols + 2}">${esc(g.name)}</td><td>${hasNew ? insBtn(tbl, `${g.name} 新日期表格`) : ''}</td></tr>`;
      g.rows.forEach((r, ri) => {
        const nums = r.v.map((v, i) => (v != null && v !== 'pending' ? i : -1)).filter((i) => i >= 0);
        const lastI = nums[nums.length - 1], prevI = nums[nums.length - 2];
        let delta = '';
        if (prevI != null) {
          const dv = parseFloat(r.v[lastI]) - parseFloat(r.v[prevI]);
          const dec = (String(r.v[lastI]).split('.')[1] || '').length;
          delta = `<span class="d">${dv > 0 ? '↑' : dv < 0 ? '↓' : '→'}${Math.abs(dv).toFixed(dec)}</span>`;
        }
        const abn = r.v.some((v) => stateOf(r, v) || v === 'pending');
        const cells = r.v.map((v, i) => {
          const since = NEW_IDX.includes(i) ? 'since' : '';
          if (v == null) return `<td class="v ${since}" data-day="${L.cols[i].d}"><span class="nil">–</span></td>`;
          if (v === 'pending') return `<td class="v ${since}" data-day="${L.cols[i].d}"><span class="c pend">pending</span></td>`;
          return `<td class="v ${since} ${i === nCols - 1 ? 'last' : ''}" data-day="${L.cols[i].d}"><span class="c ${stateOf(r, v)}">${v}</span></td>`;
        }).join('');
        const one = lastI != null ? `${r.k} ${r.v[lastI]}${r.unit ? ' ' + r.unit : ''} (${L.cols[lastI].d})` : `${r.k} pending`;
        const ref = `參考值 ${r.lo}–${r.hi}${r.unit ? ' ' + r.unit : ''}`;
        h += `<tr data-g="${gi}" data-r="${ri}" class="${abn ? 'abn' : ''}"><td><button class="k" type="button" aria-expanded="false" title="${ref}">${esc(r.k)}<small>${esc(r.unit)}</small></button></td>${cells}<td>${delta}</td><td>${insBtn(one, one)}</td></tr>`;
      });
    });
    h += '</tbody></table></section>';
    $('#col2').innerHTML = h;
  }

  function trendRow(g, r) {
    const pts = r.v.map((v, i) => (v != null && v !== 'pending' ? { i, n: parseFloat(v), s: v } : null)).filter(Boolean);
    const W = $('#col2 table.lab').clientWidth, Hh = 66;
    const labelW = W - L.cols.length * COLW - DELTAW - INSW;
    const cx = (i) => labelW + i * COLW + COLW / 2;
    const vals = pts.map((p) => p.n).concat([r.lo, r.hi]);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi === lo) hi = lo + 1;
    const padv = (hi - lo) * 0.12; lo -= padv; hi += padv;
    const y = (n) => 16 + ((hi - n) / (hi - lo)) * (Hh - 26);
    let s = `<rect class="band" x="${labelW}" width="${W - labelW - DELTAW - INSW}" y="${y(r.hi).toFixed(1)}" height="${Math.max(1, y(r.lo) - y(r.hi)).toFixed(1)}"/>`;
    const mid = Math.min(Hh - 8, Math.max(14, (y(r.hi) + y(r.lo)) / 2 + 4));
    s += `<text x="10" y="${mid.toFixed(1)}">參考 ${r.lo}–${r.hi}</text>`;
    if (pts.length > 1) s += `<polyline class="ln" points="${pts.map((p) => `${cx(p.i)},${y(p.n).toFixed(1)}`).join(' ')}"/>`;
    pts.forEach((p) => {
      s += `<circle class="pt ${stateOf(r, p.s)}" cx="${cx(p.i)}" cy="${y(p.n).toFixed(1)}" r="3"/><text x="${cx(p.i)}" y="${(y(p.n) - 6).toFixed(1)}" text-anchor="middle">${p.s}</text>`;
    });
    return `<tr class="trend"><td colspan="${L.cols.length + 3}"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(r.k)} 趨勢">${s}</svg></td></tr>`;
  }

  /** 把新日期補進 note 裡既有的 [Lab] 表格；表格不存在就在 [Lab] 段尾新增一張 */
  function labMerge() {
    if (!NEW_IDX.length) { say('上一篇之後沒有新的 Lab'); return; }
    const lines = note.value.split('\n');
    const labAt = lines.findIndex((l) => l.trim() === '[Lab]');
    if (labAt < 0) { say('這篇 note 沒有 [Lab] 段落，請先把游標放到要插入的位置再按各組的插入'); return; }
    const done = [], pend = [];
    let already = 0;
    L.groups.forEach((g) => {
      NEW_IDX.forEach((i) => {
        const day = L.cols[i].d;
        const have = g.rows.filter((r) => r.v[i] != null);
        if (!have.length) return;
        have.filter((r) => r.v[i] === 'pending').forEach((r) => pend.push(r.k));
        const hAt = lines.findIndex((l, n) => n > labAt && l.trim() === `#. ${g.name}`);
        if (hAt < 0) {
          let end = labAt + 1;
          while (end < lines.length && !/^\[|^===/.test(lines[end]) && !/^#\.\s*Culture/i.test(lines[end])) end++;
          lines.splice(end, 0, ...D.fmtTable(g, [i]).split('\n'));
          done.push(g.name);
          return;
        }
        const head = lines[hAt + 1] || '';
        let end = hAt + 2;
        while (end < lines.length && /^\d{1,2}\/\d{1,2}/.test(lines[end])) end++;
        if (lines.slice(hAt + 2, end).some((l) => l.startsWith(day))) { already++; return; }
        const cols = [...head.matchAll(/\S+/g)].map((m) => ({ k: m[0], at: m.index }));
        let row = day;
        cols.forEach((c) => {
          const r = g.rows.find((x) => x.k === c.k);
          const v = r && r.v[i] != null ? String(r.v[i]) : '-';
          row = row.padEnd(Math.max(c.at, row.length + 2)) + v;
        });
        const extra = have.filter((r) => !cols.some((c) => c.k === r.k)).map((r) => `${r.k} ${r.v[i]}`);
        if (extra.length) row += `  (${extra.join(', ')})`;
        lines.splice(end, 0, row);
        done.push(g.name);
      });
    });
    if (!done.length) { say(already ? '新日期已經在 [Lab] 裡了，沒有重複加入' : '沒有可以補的新結果'); return; }
    const days = NEW_IDX.map((i) => L.cols[i].d).join('、');
    replaceAll(lines.join('\n'), `已把 ${days} 補進 [Lab]：${done.join('、')}${pend.length ? `；${pend.join('、')} 標 pending` : ''}（Ctrl+Z 可復原）`, '[Lab]');
  }

  /* ================= 第三欄：感染、報告、護理 ================= */
  function renderCol3() {
    const C = D.cultures;
    const cxLabel = (c) => `${c.spec}${c.n > 1 ? ' ×' + c.n : ''}`;
    const pendDays = (c) => dayNo(c.t) - 1;
    const active = D.abx.filter((a) => !a.end);
    const pending = C.filter((c) => c.status === 'pending');
    const grown = C.filter((c) => c.status === 'grown');
    const quiet = C.filter((c) => c.status === 'ng');
    const nPend = pending.reduce((n, c) => n + c.n, 0);
    const sirOf = (drug) => D.antibiogram.find((r) => r[0].toLowerCase() === drug.toLowerCase());
    const cxNote = (c) => {
      const day = md(ts(c.t));
      if (c.status === 'pending') return `${day} ${c.spec}${c.n > 1 ? ' x' + c.n : ''}: pending${c.interim ? ' (' + c.interim + ')' : ''}`;
      if (c.status === 'ng') return `${day} ${c.spec}${c.n > 1 ? ' x' + c.n : ''}: ${c.org || 'no growth'}`;
      const iso = D.isolates.findIndex((x) => x.id === c.iso);
      const col = 1 + iso * 2;
      const pick = (sir) => D.antibiogram.filter((r) => r[col] === sir).map((r) => r[0]);
      return `${day} ${c.spec}: ${c.org} (${c.qty})\n  S: ${pick('S').join(', ')}\n  R: ${pick('R').join(', ')}`;
    };

    let h = `<section class="sec"><div class="sec-h"><h2>培養與藥敏</h2><span class="tag pending">${nPend} 管未發</span><span class="tag grown">${grown.length} 份有長</span><span class="sp"></span>${insBtn(() => C.filter((c) => ts(c.t) > NOW - 7 * DAY).sort((a, b) => ts(a.t) - ts(b.t)).map(cxNote).join('\n'), '#. Culture 近 7 天', 'Culture')}</div>`;

    // 目前的抗生素有沒有蓋到已知菌株
    h += '<div class="cover">';
    active.forEach((a) => {
      const row = sirOf(a.name);
      const chips = row
        ? D.isolates.map((iso, k) => `<span class="tag ${row[1 + k * 2] === 'S' ? 'new' : row[1 + k * 2] === 'R' ? 'stop' : 'edit'}">${esc(iso.org)} ${row[1 + k * 2] || '未測'}</span>`).join('')
        : `<span class="sub">已知菌株的藥敏沒有測這支；${nPend} 管血液與尿液培養未發</span>`;
      h += `<div><b>${esc(a.name)}</b><span class="tag day">D${dayNo(a.start)}</span>${chips}</div>`;
    });
    h += '</div>';

    // 逐日總覽
    const byDay = new Map();
    C.forEach((c) => { const k = md(ts(c.t)); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(c); });
    h += '<table class="days"><colgroup><col style="width:64px"><col><col style="width:30px"><col style="width:30px"><col style="width:34px"></colgroup><thead><tr><th>送檢日</th><th>檢體</th><th title="有長">長</th><th title="還在等報告">等</th><th title="沒長">無</th></tr></thead><tbody>';
    [...byDay.entries()].forEach(([day, list]) => {
      const cnt = (st) => list.filter((c) => c.status === st).reduce((n, c) => n + c.n, 0);
      const g = cnt('grown'), p = cnt('pending'), n = cnt('ng');
      const target = (list.find((c) => c.status === 'grown') || list[0]).id;
      h += `<tr class="${g ? 'g1' : ''}"><td><button class="daybtn" type="button" data-focus="cx-${target}">${day}</button></td><td>${list.map(cxLabel).join('、')}</td><td>${g ? `<span class="n-g">${g}</span>` : '<span class="nil">–</span>'}</td><td>${p ? `<span class="n-p">${p}</span>` : '<span class="nil">–</span>'}</td><td>${n || '<span class="nil">–</span>'}</td></tr>`;
    });
    h += '</tbody></table>';

    const cxRow = (c) => {
      const day = md(ts(c.t));
      let mid, tag;
      if (c.status === 'pending') {
        const dd = pendDays(c);
        tag = `<span class="tag pending" title="送出 ${dd} 天還沒有報告">D+${dd}</span>`;
        mid = `${cxLabel(c)} <span class="dose">${esc(c.site)}${c.interim ? ' · ' + esc(c.interim) : ''}</span>`;
      } else if (c.status === 'grown') {
        tag = `<span class="tag grown">有長</span>`;
        mid = `${cxLabel(c)} <span class="org">${esc(c.org)}</span> <span class="dose">${esc(c.qty)}</span>{{NEW}}${c.stain ? `<span class="dose stain">染色 ${esc(c.stain)}</span>` : ''}`;
      } else {
        tag = `<span class="tag">沒長</span>`;
        mid = `${cxLabel(c)} <span class="dose">${esc(c.org || 'no growth')}</span>`;
      }
      const isNew = c.reported && ts(c.reported) > LAST ? '<i class="dot-new" title="上一篇之後才發的報告"></i>' : '';
      return `<li class="row" id="cx-${c.id}">${tag}<span class="main">${mid.includes('{{NEW}}') ? mid.replace('{{NEW}}', isNew) : mid + isNew}</span><span class="sub">${day} ${hm(ts(c.t))}</span>${insBtn(() => cxNote(c), `${day} ${c.spec}`)}</li>`;
    };
    h += `<div class="sub-h">未發報告<span>${nPend} 管 · 血液培養要 5 天才發最終報告</span></div><ul>${pending.map(cxRow).join('')}</ul>`;
    h += `<div class="sub-h">有長<span>${grown.length} 份</span></div><ul>${grown.map(cxRow).join('')}</ul>`;
    h += `<div class="sub-h">沒長<span>${quiet.length} 份</span><span class="sp" style="flex:1"></span><button class="linkbtn" type="button" id="btnQuiet" aria-expanded="false">顯示</button></div><ul id="quietList" hidden>${quiet.map(cxRow).join('')}</ul>`;

    // 藥敏對照表
    const using = new Set(active.map((a) => a.name.toLowerCase()));
    const everUsed = new Set(D.abx.map((a) => a.name.toLowerCase()));
    const alias = { 'piperacillin/tazobactam': 'tazocin' };
    h += `<div class="sub-h">藥敏對照<span>底色那一列是使用中的抗生素</span></div>`;
    h += `<table class="abg"><colgroup><col><col style="width:96px"><col style="width:96px"></colgroup><thead><tr><th>抗生素</th>${D.isolates.map((i) => `<th>${esc(i.org)}<small>${esc(i.from)}</small></th>`).join('')}</tr></thead><tbody>`;
    D.antibiogram.forEach((r) => {
      const key = r[0].toLowerCase();
      const on = using.has(key);
      const was = !on && (everUsed.has(key) || everUsed.has(alias[key]));
      const cell = (sir, mic) => (sir ? `<span class="mic">${esc(mic)}</span><span class="sir ${sir}">${sir}</span>` : '<span class="nil">未測</span>');
      h += `<tr class="${on ? 'using' : 'dim'}"><td>${esc(r[0])}${on ? ' <span class="tag day">使用中</span>' : was ? ' <span class="tag">用過</span>' : ''}</td><td>${cell(r[1], r[2])}</td><td>${cell(r[3], r[4])}</td></tr>`;
    });
    h += '</tbody></table></section>';

    // 影像與報告
    const nNew = D.reports.filter((r) => r.isNew).length;
    h += `<section class="sec"><div class="sec-h"><h2>影像與報告</h2><span class="meta">新 ${nNew} 份 · 點一列看全文</span></div>`;
    h += D.reports.map((r) => {
      const tag = r.pending ? '<span class="tag pending">未發</span>' : `<span class="tag ${r.isNew ? 'rep' : ''}">${esc(r.kind)}</span>`;
      const line = r.pending ? `[${r.kind}] 2026/${r.d}: (formal report pending)` : `[${r.kind}] 2026/${r.d}: ${r.imp}`;
      const body = r.body ? `<div class="full" hidden>${esc(r.body)}</div>` : '';
      const inner = `<span class="sub">${r.d}</span><span class="imp">${esc(r.pending ? r.title + '，正式報告未發' : r.imp)}</span>`;
      return `<div class="rep" id="rep-${r.id}"><div class="row">${tag}${r.body ? `<button class="toggle" type="button" aria-expanded="false">${inner}</button>` : `<span class="toggle">${inner}</span>`}${insBtn(line, `${r.kind} ${r.d}`)}</div>${body}</div>`;
    }).join('');
    h += '</section>';

    h += `<section class="sec nurse"><div class="sec-h"><h2>護理紀錄</h2><span class="meta">上一篇之後 ${D.nursing.length} 筆</span></div><ul>`;
    h += D.nursing.map((n) => `<li class="row"><span class="sub">${n.at}</span><span class="main">${esc(n.text)}</span></li>`).join('');
    h += '</ul></section>';
    $('#col3').innerHTML = h;
  }

  /* ================= 事件 ================= */
  function bind() {
    // 按插入鈕時不要把焦點從 textarea 搶走，游標才留在原位
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ib, .ed-jump button, #btnLabMerge')) e.preventDefault();
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ins]');
      if (b) {
        const it = INS[+b.dataset.ins];
        insertAtCaret(typeof it.text === 'function' ? it.text() : it.text, it.label);
        return;
      }
      const sayBtn = e.target.closest('[data-say]');
      if (sayBtn) { say(sayBtn.dataset.say); return; }
      const j = e.target.closest('[data-jump]');
      if (j) { jumpTo(j.dataset.jump); return; }
      const fo = e.target.closest('[data-focus]');
      if (fo) {
        const el = document.getElementById(fo.dataset.focus);
        if (el && el.closest('[hidden]')) toggleQuiet(true);
        focusRow(fo.dataset.focus);
        return;
      }
      const rg = e.target.closest('[data-range]');
      if (rg) {
        TL.range = +rg.dataset.range;
        $$('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(x === rg)));
        drawTimeline();
        return;
      }
      const k = e.target.closest('.lab .k');
      if (k) {
        const tr = k.closest('tr');
        const open = tr.classList.toggle('open');
        k.setAttribute('aria-expanded', String(open));
        if (open) tr.insertAdjacentHTML('afterend', trendRow(L.groups[+tr.dataset.g], L.groups[+tr.dataset.g].rows[+tr.dataset.r]));
        else if (tr.nextElementSibling && tr.nextElementSibling.classList.contains('trend')) tr.nextElementSibling.remove();
        return;
      }
      const rep = e.target.closest('.rep button.toggle');
      if (rep) {
        const box = rep.closest('.rep'), full = $('.full', box);
        const open = full.hidden;
        full.hidden = !open;
        box.classList.toggle('open', open);
        rep.setAttribute('aria-expanded', String(open));
      }
    });

    $('#btnLabMerge').addEventListener('click', labMerge);
    $('#btnAbn').addEventListener('click', (e) => {
      const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
      e.currentTarget.setAttribute('aria-pressed', String(on));
      $$('.lab tbody tr[data-r]').forEach((tr) => {
        const hide = on && !tr.classList.contains('abn');
        tr.classList.toggle('hide', hide);
        if (hide && tr.classList.contains('open')) {
          tr.classList.remove('open');
          $('.k', tr).setAttribute('aria-expanded', 'false');
          if (tr.nextElementSibling && tr.nextElementSibling.classList.contains('trend')) tr.nextElementSibling.remove();
        }
      });
      $$('.lab tbody tr.g').forEach((g) => {
        g.classList.toggle('hide', on && !$$(`.lab tbody tr[data-r][data-g="${g.dataset.g}"]:not(.hide)`).length);
      });
    });
    const toggleQuiet = (force) => {
      const list = $('#quietList'), btn = $('#btnQuiet');
      const open = force === true ? true : list.hidden;
      list.hidden = !open;
      btn.textContent = open ? '收合' : '顯示';
      btn.setAttribute('aria-expanded', String(open));
    };
    $('#btnQuiet').addEventListener('click', () => toggleQuiet());

    // Lab 的日期欄和時間軸互相對照
    $('#col2').addEventListener('mouseover', (e) => {
      const c = e.target.closest('[data-day]');
      highlightDay(c ? c.dataset.day : null);
    });
    $('#col2').addEventListener('mouseleave', () => highlightDay(null));

    $('#btnCompact').addEventListener('click', (e) => {
      TL.compact = !TL.compact;
      e.currentTarget.setAttribute('aria-pressed', String(TL.compact));
      $('span', e.currentTarget).textContent = TL.compact ? '展開時間軸' : '精簡時間軸';
      drawTimeline();
    });
    $('#btnPrev').addEventListener('click', (e) => {
      const box = $('#edPrev');
      box.hidden = !box.hidden;
      e.currentTarget.setAttribute('aria-pressed', String(!box.hidden));
      if (!box.hidden) renderPrev();
    });
    $('#btnSave').addEventListener('click', () => say('原型不會寫入 HIS。正式版沿用 HIS 原生的「暫存」按鈕', true));

    ['keyup', 'click', 'select', 'input', 'blur'].forEach((ev) => note.addEventListener(ev, saveCaret));
    note.addEventListener('input', afterEdit);
  }

  /* ================= 啟動 ================= */
  renderBar();
  renderCol1();
  renderLab();
  renderCol3();
  note.value = D.draft;
  const at = D.draft.indexOf('[Event]\n') + 8;
  note.setSelectionRange(at, at);
  caret = { s: at, e: at };
  afterEdit();
  bind();
  bindTimeline();
  drawTimeline();
  note.scrollTop = Math.max(0, topOf(D.draft.indexOf('===Assessment===')) - 14);
})();
