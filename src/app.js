(() => {
  const NN = window.NN;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const css = getComputedStyle(document.documentElement), C = {};
  for (const k of ['ink', 'muted', 'rule', 'plum', 'plum-tint', 'ochre', 'ochre-tint', 'verm', 'gray', 'band', 'panel'])
    C[k.replace(/-(\w)/, (_, c) => c.toUpperCase())] = css.getPropertyValue('--' + k).trim();
  const MONO = css.getPropertyValue('--mono').trim();
  const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const num = el => (Number.isFinite(parseFloat(el.value)) ? parseFloat(el.value) : 0);
  const fmt = (v, d = 3) => (v === 0 ? '0' : Math.abs(v) < 1e-3 || Math.abs(v) >= 1e4 ? v.toExponential(2) : +v.toFixed(d) + '');
  const r2 = v => +(+v).toFixed(2);
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const cell = (k, v, cls = '') => `<div class="cell ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
  const easeOut = p => 1 - (1 - p) ** 3;
  const label = (el, text) => el.setAttribute('aria-label', text); // keeps a chart's description in step with what it shows
  const redraws = [];
  const onResize = f => { redraws.push(f); f(); };
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => redraws.forEach(f => f()), 120); });

  function fitCanvas(cv, aspect) {
    const W = cv.clientWidth || 300, H = Math.round(W * aspect), d = devicePixelRatio || 1;
    if (cv.width !== Math.round(W * d) || cv.height !== Math.round(H * d)) {
      cv.width = Math.round(W * d); cv.height = Math.round(H * d); cv.style.height = H + 'px';
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = `12px ${MONO}`;
    return { ctx, W, H };
  }

  /* ---------- 2D plane with points, lines and a shaded output ---------- */
  function plane(cv, opt = {}) {
    // bare: no ticks or axis titles, for the opener where the points carry the whole message
    const dom = opt.dom || [-0.25, 1.25], M = opt.bare ? { l: 0, r: 0, t: 0, b: 0 } : { l: 34, r: 8, t: 8, b: 30 }, span = dom[1] - dom[0];
    const off = document.createElement('canvas'), A = hex(C.ochreTint), B = hex(C.plumTint);
    let g = null, drag = -1, moved = false, hover = -1, kb = 0, focused = false;
    const P = { points: [], scene: {} };
    const toPx = (x, y) => [M.l + ((x - dom[0]) / span) * g.w, M.t + (1 - (y - dom[0]) / span) * g.h];
    const fromPx = (px, py) => [dom[0] + ((px - M.l) / g.w) * span, dom[0] + (1 - (py - M.t) / g.h) * span];
    P.draw = (scene = P.scene) => {
      P.scene = scene;
      const { ctx, W, H } = fitCanvas(cv, opt.aspect || 1);
      g = { w: W - M.l - M.r, h: H - M.t - M.b };
      const pr = Math.max(6, Math.min(9, g.w / 42));
      ctx.fillStyle = C.band; ctx.fillRect(M.l, M.t, g.w, g.h);
      ctx.save(); ctx.beginPath(); ctx.rect(M.l, M.t, g.w, g.h); ctx.clip();
      if (scene.heat) {
        // sample on a coarse grid, then let the browser's smoothing anti-alias the edges
        const r = scene.res || 3, nx = Math.ceil(g.w / r) + 1, ny = Math.ceil(g.h / r) + 1, vals = new Float32Array(nx * ny);
        off.width = nx; off.height = ny;
        const o = off.getContext('2d'), img = o.createImageData(nx, ny);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const [x, y] = fromPx(M.l + i * r, M.t + j * r), v = Math.min(1, Math.max(0, scene.heat(x, y))), k = j * nx + i;
          vals[k] = v;
          for (let c = 0; c < 3; c++) img.data[4 * k + c] = A[c] + (B[c] - A[c]) * v;
          img.data[4 * k + 3] = 255;
        }
        o.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, 0, 0, nx - 1, ny - 1, M.l, M.t, (nx - 1) * r, (ny - 1) * r);
        if (scene.contour) contour(ctx, vals, nx, ny, r);
      }
      ctx.strokeStyle = C.rule; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
      for (const t of [0, 0.5, 1]) {
        const [px] = toPx(t, 0), [, py] = toPx(0, t);
        ctx.beginPath(); ctx.moveTo(px, M.t); ctx.lineTo(px, M.t + g.h); ctx.moveTo(M.l, py); ctx.lineTo(M.l + g.w, py); ctx.stroke();
      }
      ctx.setLineDash([]);
      // line labels must not land on points, their tags, or each other
      const placed = (scene.points || P.points).flatMap(p => {
        const [px, py] = toPx(p.x, p.y), r = pr + 6;
        return [[px - r, py - r, 2 * r, 2 * r], [px + pr + 5, py - pr - 16, 30, 16]];
      });
      for (const L of scene.lines || []) drawLine(ctx, L, placed);
      ctx.restore();
      if (!opt.bare) drawAxes(ctx, W, H);
      drawPoints(ctx, scene, pr);
    };
    function drawAxes(ctx, W, H) {
      ctx.fillStyle = C.muted;
      for (const t of [0, 0.5, 1]) {
        const [px] = toPx(t, 0), [, py] = toPx(0, t);
        ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(t, px, M.t + g.h + 6);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(t, M.l - 6, py);
      }
      const ax = opt.axes || ['x1', 'x2'];
      ctx.fillStyle = C.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
      ctx.fillText(ax[0], M.l + g.w, H - 1);
      ctx.save(); ctx.translate(12, M.t); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(ax[1], 0, 0); ctx.restore();
    }
    function drawPoints(ctx, scene, pr) {
      (scene.points || P.points).forEach((p, i) => {
        const [px, py] = toPx(p.x, p.y), r = pr * (i === hover || i === drag ? 1.3 : 1);
        if (scene.next === i) { ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(px, py, r + 11, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
        if (focused && i === kb) { ctx.strokeStyle = C.verm; ctx.lineWidth = 2; ctx.strokeRect(px - r - 9, py - r - 9, 2 * r + 18, 2 * r + 18); } // keyboard selection
        if (p.mis) { ctx.strokeStyle = C.verm; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(px, py, r + 5, 0, 7); ctx.stroke(); }
        if (p.label) { ctx.fillStyle = C.plum; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill(); }
        else { ctx.fillStyle = C.band; ctx.strokeStyle = C.ochre; ctx.lineWidth = 2.5; ctx.fillRect(px - r + 1, py - r + 1, 2 * r - 2, 2 * r - 2); ctx.strokeRect(px - r + 1, py - r + 1, 2 * r - 2, 2 * r - 2); }
        const tag = scene.indexLabels ? '#' + (i + 1) : p.count > 1 ? '×' + p.count : '';
        if (tag) {
          ctx.font = `600 12px ${MONO}`; ctx.fillStyle = C.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
          ctx.fillText(tag, px + r + 7, py - r - 2); ctx.font = `12px ${MONO}`;
        }
      });
    };
    function contour(ctx, v, nx, ny, r) {
      // marching squares at 0.5 on the sampled grid
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath();
      const at = (i, j) => v[j * nx + i], X = i => M.l + i * r, Y = j => M.t + j * r;
      for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
        const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], pts = [];
        for (let e = 0; e < 4; e++) {
          const [a, b] = [c[e], c[(e + 1) % 4]], va = at(...a) - 0.5, vb = at(...b) - 0.5;
          if ((va < 0) !== (vb < 0)) { const t = va / (va - vb); pts.push([X(a[0] + t * (b[0] - a[0])), Y(a[1] + t * (b[1] - a[1]))]); }
        }
        for (let s = 0; s + 1 < pts.length; s += 2) { ctx.moveTo(...pts[s]); ctx.lineTo(...pts[s + 1]); }
      }
      ctx.stroke();
    }
    function drawLine(ctx, { w, b, color, label }, placed = []) {
      // w1 x + w2 y + b = 0, clipped to the domain box
      const ends = [], [lo, hi] = dom;
      if (Math.abs(w[1]) > 1e-12) for (const x of [lo, hi]) { const y = -(w[0] * x + b) / w[1]; if (y >= lo - 1e-9 && y <= hi + 1e-9) ends.push([x, y]); }
      if (Math.abs(w[0]) > 1e-12) for (const y of [lo, hi]) { const x = -(w[1] * y + b) / w[0]; if (x >= lo - 1e-9 && x <= hi + 1e-9) ends.push([x, y]); }
      const far = ends.find(e => Math.hypot(e[0] - ends[0][0], e[1] - ends[0][1]) > 1e-9);
      if (!far) return;
      const S = toPx(...ends[0]), E = toPx(...far);
      ctx.strokeStyle = color || C.ink; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(...S); ctx.lineTo(...E); ctx.stroke();
      if (label) {
        ctx.font = `600 12px ${MONO}`;
        const bw = ctx.measureText(label).width + 8, bh = 18, dx = E[0] - S[0], dy = E[1] - S[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
        const off = (Math.abs(nx) * bw + Math.abs(ny) * bh) / 2 + 5; // far enough that the box clears its own line
        const hits = (a, q) => a[0] < q[0] + q[2] && q[0] < a[0] + a[2] && a[1] < q[1] + q[3] && q[1] < a[1] + a[3];
        const inside = a => a[0] >= M.l && a[1] >= M.t && a[0] + a[2] <= M.l + g.w && a[1] + a[3] <= M.t + g.h;
        let box = null;
        for (const t of [0.2, 0.8, 0.35, 0.65, 0.5, 0.1, 0.9]) for (const s of [1, -1]) {
          if (box) break;
          const cx = S[0] + dx * t + nx * s * off, cy = S[1] + dy * t + ny * s * off, a = [cx - bw / 2, cy - bh / 2, bw, bh];
          if (inside(a) && !placed.some(q => hits(a, q))) box = a;
        }
        box = box || [S[0] + dx * 0.2 + nx * off - bw / 2, S[1] + dy * 0.2 + ny * off - bh / 2, bw, bh];
        placed.push(box);
        ctx.fillStyle = C.band; ctx.fillRect(...box);
        ctx.fillStyle = color || C.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(label, box[0] + bw / 2, box[1] + bh / 2 + 0.5);
        ctx.font = `12px ${MONO}`;
      }
    }
    if (opt.editable) {
      const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      const hit = (px, py) => {
        let best = -1, bd = 18;
        P.points.forEach((p, i) => { const [x, y] = toPx(p.x, p.y), d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = i; } });
        return best;
      };
      cv.addEventListener('touchstart', e => { const r = cv.getBoundingClientRect(), t = e.touches[0]; if (g && hit(t.clientX - r.left, t.clientY - r.top) >= 0) e.preventDefault(); }, { passive: false });
      cv.addEventListener('pointerdown', e => {
        if (!g || drag >= 0) return;
        drag = hit(...pos(e)); moved = false;
        if (drag >= 0) { cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; P.draw(); }
      });
      cv.addEventListener('pointermove', e => {
        if (!g) return;
        if (drag < 0) {
          const h = hit(...pos(e));
          if (h !== hover) { hover = h; cv.style.cursor = h >= 0 ? 'grab' : 'default'; P.draw(); }
          return;
        }
        const [x, y] = fromPx(...pos(e)), s = v => Math.min(dom[1], Math.max(dom[0], Math.round(v * 20) / 20)), p = P.points[drag];
        if (s(x) !== p.x || s(y) !== p.y) { p.x = s(x); p.y = s(y); moved = true; opt.onChange(); }
      });
      const end = () => {
        if (drag >= 0 && !moved) { P.points[drag].label ^= 1; opt.onChange(); }
        drag = -1; cv.style.cursor = hover >= 0 ? 'grab' : 'default'; P.draw();
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', () => { drag = -1; });
      cv.addEventListener('pointerleave', () => { if (drag < 0 && hover >= 0) { hover = -1; P.draw(); } });
      // keyboard: N / P pick a point, arrows move it (Shift for bigger steps), Enter or Space flips its label
      cv.tabIndex = 0;
      const live = document.createElement('p');
      live.className = 'sr-only'; live.setAttribute('aria-live', 'polite');
      cv.after(live);
      const say = () => { const p = P.points[kb]; if (p) live.textContent = `Point ${kb + 1} of ${P.points.length}, at (${p.x}, ${p.y}), label ${p.label}.`; };
      cv.addEventListener('focus', () => { focused = true; kb = Math.min(kb, P.points.length - 1); say(); P.draw(); });
      cv.addEventListener('blur', () => { focused = false; P.draw(); });
      cv.addEventListener('keydown', e => {
        const n = P.points.length; if (!n) return;
        kb = Math.min(kb, n - 1); // a preset may have swapped in fewer points
        const p = P.points[kb], st = e.shiftKey ? 0.25 : 0.05, c = v => Math.min(dom[1], Math.max(dom[0], Math.round(v * 20) / 20));
        const move = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
        if (move) { p.x = c(p.x + move[0]); p.y = c(p.y + move[1]); opt.onChange(); }
        else if (e.key === 'n' || e.key === 'N' || e.key === ']') kb = (kb + 1) % n;
        else if (e.key === 'p' || e.key === 'P' || e.key === '[') kb = (kb - 1 + n) % n;
        else if (e.key === 'Enter' || e.key === ' ') { p.label ^= 1; opt.onChange(); }
        else return;
        e.preventDefault(); say(); P.draw();
      });
    }
    return P;
  }

  /* ---------- 1D plot ---------- */
  function niceTicks(lo, hi, n = 5) {
    const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0)), step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= step0);
    const out = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
  }
  function plot(cv, opt) {
    const M = { l: 48, r: 12, t: 10, b: opt.xlabel ? 42 : 30 };
    return (series, extra = {}) => {
      const { ctx, W, H } = fitCanvas(cv, opt.aspect || 0.5), w = W - M.l - M.r, h = H - M.t - M.b;
      const [x0, x1] = extra.x || opt.x, [y0, y1] = extra.y || opt.y, log = opt.log;
      const Y = v => (log ? (v <= 0 ? y0 : Math.log10(v)) : v);
      const px = x => M.l + ((x - x0) / (x1 - x0)) * w, py = v => M.t + (1 - (Math.min(y1, Math.max(y0, Y(v))) - y0) / (y1 - y0)) * h;
      ctx.fillStyle = C.band; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      // with zeros present, the bottom line of a log axis means exactly 0, so it gets no decade label
      const zeroAt = log && opt.zeroLine && extra.hasZero;
      const yt = (log ? niceTicks(y0, y1, 4).filter(v => Number.isInteger(v)) : niceTicks(y0, y1, 4)).filter(t => !(zeroAt && t === y0));
      for (const t of yt) {
        const yy = M.t + (1 - (t - y0) / (y1 - y0)) * h;
        ctx.fillText(log ? (t === 0 ? '1' : `1e${t}`) : t, M.l - 6, yy);
        ctx.strokeStyle = C.rule; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(M.l, yy); ctx.lineTo(M.l + w, yy); ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.strokeStyle = C.rule; ctx.beginPath(); ctx.moveTo(M.l, M.t + h); ctx.lineTo(M.l + w, M.t + h); ctx.stroke();
      if (zeroAt) { ctx.fillStyle = C.ink; ctx.fillText('0', M.l - 6, M.t + h); }
      ctx.textBaseline = 'top'; ctx.fillStyle = C.muted;
      for (const t of niceTicks(x0, x1, opt.xticks || 5)) {
        const half = ctx.measureText(t).width / 2;
        ctx.textAlign = px(t) + half > W ? 'right' : 'center';
        ctx.fillText(t, ctx.textAlign === 'right' ? W - 1 : px(t), M.t + h + 5);
      }
      if (opt.xlabel) { ctx.fillStyle = C.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(opt.xlabel, M.l + w, H); }
      ctx.save(); ctx.beginPath(); ctx.rect(M.l, M.t - 2, w, h + 4); ctx.clip();
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (const s of series) {
        ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.globalAlpha = s.alpha ?? 1;
        ctx.beginPath();
        s.xs.forEach((x, i) => (i ? ctx.lineTo(px(x), py(s.ys[i])) : ctx.moveTo(px(x), py(s.ys[i]))));
        ctx.stroke();
        if (s.dots) { ctx.fillStyle = s.color; s.dots.forEach(([x, v]) => { ctx.beginPath(); ctx.arc(px(x), py(v), 3.5, 0, 7); ctx.fill(); }); }
      }
      ctx.restore(); ctx.globalAlpha = 1;
      if (extra.empty) {
        ctx.font = `13px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(extra.empty).width;
        ctx.fillStyle = C.band; ctx.fillRect(M.l + w / 2 - tw / 2 - 8, M.t + h / 2 - 11, tw + 16, 22);
        ctx.fillStyle = C.muted; ctx.fillText(extra.empty, M.l + w / 2, M.t + h / 2);
      }
    };
  }
  const logRange = vals => {
    const pos = vals.filter(v => v > 0);
    if (!pos.length) return [-8, 0];
    return [Math.floor(Math.log10(Math.min(...pos))) - (vals.some(v => v === 0) ? 1 : 0), Math.ceil(Math.log10(Math.max(...pos)) + 1e-9)];
  };

  // Moves a line from where it is drawn to where it now is, so each update reads as a motion.
  function tween(get, set, draw) {
    let raf = 0;
    return (to, ms = 220) => {
      cancelAnimationFrame(raf);
      const from = get();
      if (STILL || ms <= 0) { set(to); draw(); return; }
      const t0 = performance.now();
      const f = now => {
        const p = easeOut(Math.min(1, (now - t0) / ms));
        set({ w: [0, 1].map(i => from.w[i] + (to.w[i] - from.w[i]) * p), b: from.b + (to.b - from.b) * p });
        draw();
        if (p < 1) raf = requestAnimationFrame(f);
      };
      raf = requestAnimationFrame(f);
    };
  }

  /* ---------- node-and-edge network diagrams ---------- */
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // spec: { h, cols: [{ title, nodes: [{ label, sub, cls, r }] }], edges: [{ a: [col, i], b: [col, j], label, cls, w, t }], extra(W, H, pos) }
  function net(el, spec) {
    const W = Math.max(280, el.clientWidth || 600), H = spec.h || 220, narrow = W < 480, n = spec.cols.length;
    const padX = narrow ? Math.min(spec.padX ?? 56, 40) : spec.padX ?? 56, top = spec.top ?? 16, bottom = spec.bottom ?? 40;
    const colX = c => (n === 1 ? W / 2 : padX + (c * (W - 2 * padX)) / (n - 1));
    const pos = spec.cols.map((col, c) => col.nodes.map((_, i) => [colX(c), top + ((H - top - bottom) * (i + 0.5)) / col.nodes.length]));
    // phones get smaller neurons so edge labels have room; small dots stay as they are
    const rOf = (c, i) => { const r = spec.cols[c].nodes[i].r ?? spec.r ?? 20; return narrow && r >= 10 ? r * 0.75 : r; };
    let s = '';
    for (const e of spec.edges || []) {
      const [x1, y1] = pos[e.a[0]][e.a[1]], [x2, y2] = pos[e.b[0]][e.b[1]], d = Math.hypot(x2 - x1, y2 - y1) || 1;
      const ra = rOf(...e.a), rb = rOf(...e.b), ux = (x2 - x1) / d, uy = (y2 - y1) / d;
      s += `<line class="edge ${e.cls || ''}" x1="${x1 + ux * ra}" y1="${y1 + uy * ra}" x2="${x2 - ux * rb}" y2="${y2 - uy * rb}"${e.w ? ` style="stroke-width:${e.w}"` : ''}/>`;
      if (e.label !== undefined && e.label !== '') {
        const t = e.t ?? 0.45, lx = x1 + (x2 - x1) * t, ly = y1 + (y2 - y1) * t, tw = String(e.label).length * 7.6 + 8;
        s += `<rect class="lblbg" x="${lx - tw / 2}" y="${ly - 9}" width="${tw}" height="18" rx="2"/><text x="${lx}" y="${ly + 4.5}" text-anchor="middle">${esc(e.label)}</text>`;
      }
    }
    spec.cols.forEach((col, c) => col.nodes.forEach((nd, i) => {
      const [x, y] = pos[c][i], r = rOf(c, i);
      s += `<circle class="node ${nd.cls || ''}" cx="${x}" cy="${y}" r="${r}"/>`;
      if (nd.label !== undefined) s += `<text x="${x}" y="${y + 4.5}" text-anchor="middle" style="font-weight:600">${esc(nd.label)}</text>`;
      [].concat(nd.sub || []).forEach((line, k) => { s += `<text class="sub" x="${x}" y="${y + r + 15 + k * 14}" text-anchor="middle">${esc(line)}</text>`; });
    }));
    spec.cols.forEach((col, c) => { if (col.title) s += `<text class="title" x="${colX(c)}" y="${H - 6}" text-anchor="middle">${esc(col.title)}</text>`; });
    if (spec.extra) s += spec.extra(W, H, pos);
    el.innerHTML = `<svg class="net" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.aria || '')}">${s}</svg>`;
  }
  const arrowDefs = id => `<defs><marker id="${id}f" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ahead" d="M0,0 L10,5 L0,10 z"/></marker>`
    + `<marker id="${id}b" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ahead back" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;

  /* ---------- diagram: one perceptron, the umbrella example ---------- */
  {
    const el = $('[data-net=perceptron]');
    onResize(() => net(el, {
      h: 210, aria: 'Two inputs, cloudy and rain forecast, each multiplied by a weight, feed one perceptron that outputs take umbrella or not',
      cols: [{ title: 'INPUTS', nodes: [{ label: 'x1', sub: 'cloudy?', cls: 'input' }, { label: 'x2', sub: ['rain', 'forecast?'], cls: 'input' }] },
        { title: 'PERCEPTRON', nodes: [{ label: 'Σ', sub: 'add bias b, then step', r: 26 }] },
        { title: 'OUTPUT', nodes: [{ label: 'ŷ', sub: ['umbrella?', '1 or 0'], cls: 'input' }] }],
      edges: [{ a: [0, 0], b: [1, 0], label: '× w1' }, { a: [0, 1], b: [1, 0], label: '× w2' }, { a: [1, 0], b: [2, 0] }],
    }));
  }

  /* ---------- diagram: forward values, backward blame ---------- */
  {
    const el = $('[data-net=backprop]');
    onResize(() => net(el, {
      h: 250, top: 44, bottom: 52, aria: 'A two-layer network: values flow forward from inputs to output, and blame flows backward from the error to every weight',
      cols: [{ nodes: [{ label: 'x1', cls: 'input' }, { label: 'x2', cls: 'input' }] }, { nodes: [{ label: 'h1' }, { label: 'h2' }] }, { nodes: [{ label: 'ŷ' }] }],
      edges: [[0, 0, 1, 0], [0, 0, 1, 1], [0, 1, 1, 0], [0, 1, 1, 1], [1, 0, 2, 0], [1, 1, 2, 0]].map(([a, i, b, j]) => ({ a: [a, i], b: [b, j] })),
      extra: (W, H, pos) => {
        const x0 = pos[0][0][0], x1 = pos[2][0][0], narrow = W < 480;
        const fwd = narrow ? 'Forward: inputs → output' : 'Forward: values flow from inputs to output', back = narrow ? 'Backward: error → every weight' : 'Backward: blame flows from the error to every weight';
        return arrowDefs('bp') + `<line class="arrow" x1="${x0}" y1="16" x2="${x1}" y2="16" marker-end="url(#bpf)"/><text x="${(x0 + x1) / 2}" y="34" text-anchor="middle">${fwd}</text>`
          + `<line class="arrow back" x1="${x1}" y1="${H - 34}" x2="${x0}" y2="${H - 34}" marker-end="url(#bpb)"/><text class="backtext" x="${(x0 + x1) / 2}" y="${H - 10}" text-anchor="middle">${back}</text>`;
      },
    }));
  }

  /* ---------- diagram: one GPT-3 layer, MLP drawn to scale ---------- */
  {
    const el = $('[data-net=gpt3]');
    const draw = () => {
      const W = Math.max(300, el.clientWidth || 600), H = 250, half = W * 0.42;
      let s = arrowDefs('g3');
      // left: a stack of layers, the front one opened up
      const bx = 8, by = 34, bw = Math.min(190, half - 30), bh = 170;
      for (let k = 2; k > 0; k--) s += `<rect class="box ghost" x="${bx + k * 7}" y="${by - k * 7}" width="${bw}" height="${bh}"/>`;
      s += `<rect class="box" x="${bx}" y="${by}" width="${bw}" height="${bh}"/>`;
      s += `<text class="title" x="${bx}" y="14">ONE OF 96 LAYERS</text>`;
      const ix = bx + 14, iw = bw - 28;
      s += `<rect class="box ghost" x="${ix}" y="${by + 16}" width="${iw}" height="56"/><text x="${ix + iw / 2}" y="${by + 49}" text-anchor="middle">Attention</text>`;
      s += `<line class="arrow" x1="${ix + iw / 2}" y1="${by + 76}" x2="${ix + iw / 2}" y2="${by + 92}" marker-end="url(#g3f)"/>`;
      s += `<rect class="box" x="${ix}" y="${by + 96}" width="${iw}" height="56" style="stroke:var(--plum);stroke-width:2.5"/><text x="${ix + iw / 2}" y="${by + 129}" text-anchor="middle" style="fill:var(--plum);font-weight:600">MLP</text>`;
      // right: the MLP's three layers as bars, height proportional to unit count
      const rx = half + 20, rw = W - rx - 8, max = 160, base = 200, sizes = [12288, 49152, 12288], names = ['in', 'hidden', 'out'];
      const bwid = Math.min(46, rw / 5), gap = (rw - 3 * bwid) / 2;
      s += `<text class="title" x="${rx}" y="14">INSIDE THE MLP BLOCK</text>`;
      sizes.forEach((u, i) => {
        const h = (max * u) / 49152, x = rx + i * (bwid + gap);
        s += `<rect class="bar" x="${x}" y="${base - h}" width="${bwid}" height="${h}" style="opacity:${i === 1 ? 1 : 0.55}"/>`;
        s += `<text x="${x + bwid / 2}" y="${base + 18}" text-anchor="middle" style="font-weight:600">${u.toLocaleString('en-US')}</text><text class="sub" x="${x + bwid / 2}" y="${base + 34}" text-anchor="middle">${names[i]}</text>`;
        if (i < 2) s += `<line class="edge faint" x1="${x + bwid}" y1="${base - h}" x2="${x + bwid + gap}" y2="${base - (max * sizes[i + 1]) / 49152}"/><line class="edge faint" x1="${x + bwid}" y1="${base}" x2="${x + bwid + gap}" y2="${base}"/>`;
      });
      s += `<line class="edge faint" x1="${bx + bw}" y1="${by + 124}" x2="${rx - 6}" y2="${base - 40}" style="stroke-dasharray:3 3"/>`;
      el.innerHTML = `<svg class="net" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="One GPT-3 layer: an attention block, then an MLP block with 12,288 inputs, 49,152 hidden units and 12,288 outputs. The model stacks 96 of these layers.">${s}</svg>`;
    };
    onResize(draw);
  }

  /* ---------- opener: a line sweeping across XOR, scored live ---------- */
  {
    const root = $('#fig-hero'), read = $('.hero-cells', root);
    const data = [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]].map(([x, y, label]) => ({ x, y, label }));
    const pl = plane($('canvas', root), { aspect: 0.82, bare: true, dom: [-0.3, 1.3] }), best = NN.bestLinear(data);
    let most = 0, visible = true, t = 4, shown = '';
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);
    const frame = () => {
      // the line's normal turns slowly while it slides back and forth through the square
      const th = 0.35 * t, s = 0.55 * Math.sin(0.23 * t), w = [Math.cos(th), Math.sin(th)], b = -(0.5 * w[0] + 0.5 * w[1]) - s;
      const k = NN.accuracy(w, b, data);
      most = Math.max(most, k);
      pl.draw({ heat: (x, y) => NN.predict(w, b, [x, y]), res: 2, lines: [{ w, b }], points: data.map(p => ({ ...p, mis: NN.predict(w, b, [p.x, p.y]) !== p.label })) });
      const html = cell('Right now', `${k}<small>/4 right</small>`) + cell('Best so far', `${most}<small>/4</small>`) + cell('Best possible', `${best}<small>/4</small>`, 'bad');
      if (html !== shown) { read.innerHTML = shown = html; label($('canvas', root), `One straight line crossing the four XOR points. Right now it gets ${k} of 4 right; no line can get more than ${best}.`); } // the score changes rarely; don't rebuild it every frame
    };
    const loop = () => { if (visible && !document.hidden) { t += 1 / 60; frame(); } requestAnimationFrame(loop); };
    onResize(frame);
    if (!STILL) requestAnimationFrame(loop);
  }

  /* ---------- Fig 1: the perceptron rule ---------- */
  {
    const root = $('#fig-perceptron'), labels = { OR: [0, 1, 1, 1], XOR: [0, 1, 1, 0] };
    const make = k => [[0, 0], [0, 1], [1, 0], [1, 1]].map(([x, y], i) => ({ x, y, label: labels[k][i] }));
    const ins = $$('input[data-w]', root), status = $('.status', root), log = $('.log', root), playBtn = $('[data-act=run]', root);
    let data = make('OR'), tr, shown = { w: [0, 0], b: 0 }, playing = 0;
    const pl = plane($('canvas', root), { editable: true, onChange: () => reset() });
    const move = tween(() => shown, v => (shown = v), () => render());
    const reset = () => {
      stop();
      tr = NN.perceptron(data, [num(ins[0]), num(ins[1])], num(ins[2]));
      shown = { w: [...tr.w], b: tr.b }; log.innerHTML = ''; render();
    };
    const sync = () => { ins[0].value = tr.w[0]; ins[1].value = tr.w[1]; ins[2].value = tr.b; };
    const describe = () => {
      if (tr.status === 'converged') return `<b>Solved.</b> A full pass with no mistakes, after ${tr.updates} fixes. Final line: w = (${tr.w[0]}, ${tr.w[1]}), b = ${tr.b}.`;
      if (tr.status === 'cycle') { const c = tr.cycle; return `<b>Stuck in a loop.</b> At example #${c.example + 1}, the weights w = (${c.w[0]}, ${c.w[1]}), b = ${c.b} are exactly the ones it had there in epoch ${c.firstEpoch}. ${c.length} fixes later they're back, in epoch ${c.againEpoch}. It will repeat this forever.`; }
      const p = data[tr.i];
      return tr.last ? `Epoch ${tr.epoch}. Next up: example #${tr.i + 1} at (${p.x}, ${p.y}). ${tr.updates} fixes so far.` : `Ready. The rule starts from the weights above and looks at example #1 first.`;
    };
    function render() {
      pl.points = data;
      const pts = data.map(p => ({ ...p, mis: NN.predict(tr.w, tr.b, [p.x, p.y]) !== p.label }));
      pl.draw({ heat: (x, y) => NN.predict(shown.w, shown.b, [x, y]), res: 2, lines: [shown], points: pts, next: tr.status === 'running' ? tr.i : -1, indexLabels: true });
      status.innerHTML = describe();
      status.className = 'status' + (tr.status === 'cycle' ? ' cycle' : '');
      $('canvas', root).setAttribute('aria-label', `Perceptron line w = (${tr.w[0]}, ${tr.w[1]}), b = ${tr.b}; ${NN.accuracy(tr.w, tr.b, data)} of ${data.length} points correct`);
    }
    const addLog = () => {
      const l = tr.last, p = data[l.i], li = document.createElement('li');
      li.textContent = `Epoch ${l.epoch} · #${l.i + 1} (${p.x}, ${p.y}) label ${l.label}, said ${l.yhat} → ${l.sign > 0 ? 'add input' : l.sign < 0 ? 'subtract input' : 'no change'}${l.sign ? `: w = (${l.w[0]}, ${l.w[1]}), b = ${l.b}` : ''}`;
      log.prepend(li);
      while (log.children.length > 60) log.lastChild.remove();
    };
    const steps = (n, ms = 220) => {
      for (let k = 0; k < n && tr.status === 'running'; k++) { const before = tr.last; tr.step(); if (tr.last !== before) addLog(); }
      sync(); move({ w: [...tr.w], b: tr.b }, ms);
    };
    function stop() { cancelAnimationFrame(playing); playing = 0; playBtn.textContent = 'Play'; }
    function play() {
      if (playing) return stop();
      if (tr.status !== 'running') reset();
      if (STILL) { steps(1000 * data.length + 1, 0); return done(); }
      playBtn.textContent = 'Pause';
      let n = 0, last = 0;
      const tick = now => {
        // starts slow enough to follow each update, then speeds up
        const gap = Math.max(0, 420 - n * 25);
        if (now - last >= gap) { const k = gap ? 1 : Math.min(40, 1 + (n >> 3)); steps(k, Math.min(220, gap)); n += k; last = now; }
        if (tr.status === 'running' && tr.epoch <= 1000) playing = requestAnimationFrame(tick); else { stop(); done(); }
      };
      playing = requestAnimationFrame(tick);
    }
    const done = () => { if (tr.status === 'running') status.textContent = 'Stopped after 1,000 epochs without settling or looping. That proves neither.'; };
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.preset) { data = make(b.dataset.preset); $$('[data-preset]', root).forEach(x => x.setAttribute('aria-pressed', x === b)); reset(); }
      else if (b.dataset.act === 'step') { stop(); steps(1); }
      else if (b.dataset.act === 'epoch') { stop(); const e0 = tr.epoch; let k = 0; while (tr.status === 'running' && tr.epoch === e0 && k++ <= data.length) steps(1, 0); move({ w: [...tr.w], b: tr.b }); }
      else if (b.dataset.act === 'run') play();
      else if (b.dataset.act === 'reset') reset();
    });
    ins.forEach(i => i.addEventListener('input', reset));
    reset();
    onResize(render);
  }

  /* ---------- Fig 2: linear separability ---------- */
  {
    const root = $('#fig-separable'), sl = $$('input[data-w]', root), outs = $$('[data-out]', root), cells = $('.cells', root);
    const truth = { AND: [0, 0, 0, 1], OR: [0, 1, 1, 1], XOR: [0, 1, 1, 0] };
    let seed = 1, preset = 'OR', data, line = { w: [1, 1], b: -0.5 };
    const sample = s => {
      const r = NN.rng(s), t = r() * 2 * Math.PI, c = [0.3 + 0.4 * r(), 0.3 + 0.4 * r()], n = [Math.cos(t), Math.sin(t)], pts = [];
      while (pts.length < 24) { const x = r(), y = r(), d = n[0] * (x - c[0]) + n[1] * (y - c[1]); if (Math.abs(d) >= 0.05) pts.push({ x: +x.toFixed(3), y: +y.toFixed(3), label: d > 0 ? 1 : 0 }); }
      return pts;
    };
    const pl = plane($('canvas', root), { editable: true, onChange: () => render() });
    const move = tween(() => line, v => (line = v), () => render());
    // one group inside a circle, the other in a ring around it: a common real-data shape no line can split
    const rings = () => {
      // outer points are spread evenly around the circle, with a little jitter, so the ring reads as a ring
      const r = NN.rng(7), pt = (t, d) => [+(0.5 + d * Math.cos(t)).toFixed(3), +(0.5 + d * Math.sin(t)).toFixed(3)];
      const inner = Array.from({ length: 10 }, () => [...pt(r() * 2 * Math.PI, 0.2 * Math.sqrt(r())), 1]);
      const outer = Array.from({ length: 20 }, (_, i) => [...pt(((i + 0.6 * r()) / 20) * 2 * Math.PI, 0.34 + 0.1 * r()), 0]);
      return [...inner, ...outer].map(([x, y, label]) => ({ x, y, label }));
    };
    const load = () => {
      data = preset === 'random' ? sample(seed) : preset === 'rings' ? rings() : [[0, 0], [0, 1], [1, 0], [1, 1]].map(([x, y], i) => ({ x, y, label: truth[preset][i] }));
      pl.points = data; render();
    };
    function render() {
      const { w, b } = line;
      [w[0], w[1], b].forEach((v, i) => { outs[i].textContent = r2(v).toFixed(2); });
      pl.draw({ heat: (x, y) => NN.predict(w, b, [x, y]), res: 2, lines: [{ w, b }], points: data.map(p => ({ ...p, mis: NN.predict(w, b, [p.x, p.y]) !== p.label })) });
      const acc = NN.accuracy(w, b, data), best = NN.bestLinear(data), n = data.length;
      label($('canvas', root), `${preset === 'random' ? 'Random' : preset === 'rings' ? 'Rings' : preset} data, ${n} points. This line gets ${acc} right; the best any line can do is ${best}.`);
      cells.innerHTML = cell('This line', `${acc}<small>/${n}</small>`, acc === n ? 'good' : '') + cell('Best any line can do', `${best}<small>/${n}</small>`, best < n ? 'bad' : 'good')
        + `<div class="cell" style="grid-column:1/-1"><div class="k">${preset === 'random' ? `Random sample, seed ${seed}` : preset === 'rings' ? 'Rings: one group inside, one around it' : preset}</div><div class="k" style="color:var(--ink)">${best < n ? 'No straight line separates these points.' : 'A straight line can separate these points.'}</div></div>`;
    }
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'best') {
        const L = NN.bestLine(data), m = Math.max(Math.abs(L.w[0]), Math.abs(L.w[1]), Math.abs(L.b)) / 3.5;
        const to = { w: [L.w[0] / Math.max(1, m), L.w[1] / Math.max(1, m)], b: L.b / Math.max(1, m) }; // same line, scaled to fit the sliders
        sl.forEach((s, i) => (s.value = i < 2 ? to.w[i] : to.b));
        return move(to, 450);
      }
      if (b.dataset.preset) { preset = b.dataset.preset; $$('[data-preset]', root).forEach(x => x.setAttribute('aria-pressed', x === b)); }
      if (b.dataset.act === 'resample') { preset = 'random'; seed++; $$('[data-preset]', root).forEach(x => x.setAttribute('aria-pressed', x.dataset.preset === 'random')); }
      load();
    });
    sl.forEach(s => s.addEventListener('input', () => { line = { w: [num(sl[0]), num(sl[1])], b: num(sl[2]) }; render(); }));
    load();
    onResize(render);
  }

  /* ---------- Fig 3: the three-neuron XOR network ---------- */
  {
    const root = $('#fig-network'), ins = $$('input[data-w]', root), def = [1, 1, -0.5, -1, -1, 1.5, 1, 1, -1.5];
    const X = [[0, 0], [0, 1], [1, 0], [1, 1]], xor = [0, 1, 1, 0], st = z => (z > 0 ? 1 : 0);
    const pin = plane($('[data-role=input]', root), { aspect: 1 }), phid = plane($('[data-role=hidden]', root), { aspect: 1, axes: ['h1', 'h2'] });
    let scramble = 1;
    const set = v => ins.forEach((el, i) => (el.value = v[i]));
    function render() {
      const v = ins.map(num), H = ([a, b]) => [st(v[0] * a + v[1] * b + v[2]), st(v[3] * a + v[4] * b + v[5])], O = ([h1, h2]) => st(v[6] * h1 + v[7] * h2 + v[8]);
      const rows = X.map((x, i) => { const h = H(x), o = O(h); return { x, h, o, t: xor[i] }; });
      pin.draw({ heat: (a, b) => O(H([a, b])), res: 2, lines: [{ w: [v[0], v[1]], b: v[2], label: 'Neuron 1' }, { w: [v[3], v[4]], b: v[5], label: 'Neuron 2' }],
        points: rows.map(r => ({ x: r.x[0], y: r.x[1], label: r.t, mis: r.o !== r.t })) });
      const groups = new Map();
      rows.forEach(r => { const k = r.h + '|' + r.t, g = groups.get(k); groups.set(k, { x: r.h[0], y: r.h[1], label: r.t, mis: g?.mis || r.o !== r.t, count: (g?.count || 0) + 1 }); });
      // a 1 and a 0 on the same hidden point can't be split by any output line, so show both, side by side
      const hp = [...groups.values()];
      hp.forEach(p => { if (hp.some(q => q !== p && q.x === p.x && q.y === p.y)) p.x += p.label ? 0.11 : -0.11; });
      phid.draw({ heat: (a, b) => O([a, b]), res: 2, lines: [{ w: [v[6], v[7]], b: v[8], label: 'Output' }], points: hp });
      const isDef = v.every((x, i) => x === def[i]), sr = rows[sel], on = b => (b ? ' on' : '');
      const ec = w => (w > 0 ? 'pos' : w < 0 ? 'neg' : ''), ew = w => 1 + Math.min(3, Math.abs(w)) * 1.1;
      const edge = (a, b, w, t) => ({ a, b, label: r2(w), cls: ec(w), w: ew(w), t });
      net($('[data-role=net]', root), {
        h: 250, padX: 64, bottom: 30, aria: `Network diagram for input (${sr.x[0]}, ${sr.x[1]}): hidden outputs ${sr.h[0]} and ${sr.h[1]}, network output ${sr.o}`,
        cols: [{ title: 'INPUTS', nodes: [{ label: sr.x[0], sub: 'x1', cls: 'input' + on(sr.x[0]) }, { label: sr.x[1], sub: 'x2', cls: 'input' + on(sr.x[1]) }] },
          { title: 'HIDDEN LAYER', nodes: [{ label: sr.h[0], sub: [isDef ? 'h1 · OR' : 'h1', `bias ${r2(v[2])}`], cls: on(sr.h[0]) }, { label: sr.h[1], sub: [isDef ? 'h2 · NAND' : 'h2', `bias ${r2(v[5])}`], cls: on(sr.h[1]) }] },
          { title: 'OUTPUT', nodes: [{ label: sr.o, sub: [isDef ? 'out · AND' : 'out', `bias ${r2(v[8])}`], cls: on(sr.o) }] }],
        // the two crossing edges meet in the middle, so their labels sit near their inputs instead
        edges: [edge([0, 0], [1, 0], v[0], 0.55), edge([0, 1], [1, 0], v[1], 0.25), edge([0, 0], [1, 1], v[3], 0.25), edge([0, 1], [1, 1], v[4], 0.55), edge([1, 0], [2, 0], v[6], 0.5), edge([1, 1], [2, 0], v[7], 0.5)],
      });
      $('[data-role=net-caption]', root).innerHTML = `Showing input <b>(${sr.x[0]}, ${sr.x[1]})</b>: the network says <b>${sr.o}</b>, XOR says <b>${sr.t}</b>. Filled circles are neurons that fire. Click a table row to send a different input through.`;
      $('tbody', root).innerHTML = rows.map((r, i) => `<tr data-i="${i}" class="${r.o !== r.t ? 'bad' : ''}${i === sel ? ' current' : ''}"><td>${r.x[0]}</td><td>${r.x[1]}</td><td>${r.h[0]}</td><td>${r.h[1]}</td><td>${r.o}</td><td>${r.t}</td><td>${r.o === r.t ? '✓' : '✗'}</td></tr>`).join('');
      const right = rows.filter(r => r.o === r.t).length;
      label($('[data-role=input]', root), `Input plane with the two hidden neurons' lines. The network gets ${right} of 4 XOR cases right.`);
      label($('[data-role=hidden]', root), `Hidden plane with the output neuron's line. ${right} of 4 cases end up on the correct side.`);
      const ok = rows.filter(r => r.o === r.t).length, verdict = $('[data-role=verdict]', root);
      verdict.className = 'status' + (ok === 4 ? ' solved' : '');
      verdict.innerHTML = (justScrambled ? 'Weights scrambled. ' : '') + (ok === 4
        ? `<b>All 4 rows match XOR.</b> ${v.every((x, i) => x === def[i]) ? 'These are the OR, NAND and AND neurons from the text.' : 'You found weights that work.'}`
        : `<b>${ok} of 4 rows match XOR.</b> Change the numbers below to fix the red rows, or press Reset.`);
    }
    let justScrambled = false, sel = 1;
    $('tbody', root).addEventListener('click', e => { const tr = e.target.closest('tr'); if (tr) { sel = +tr.dataset.i; render(); } });
    ins.forEach(i => i.addEventListener('input', () => { justScrambled = false; render(); }));
    root.addEventListener('click', e => {
      const a = e.target.closest('button')?.dataset.act;
      justScrambled = a === 'scramble';
      if (a === 'reset') set(def);
      if (a === 'scramble') { const r = NN.rng(scramble++); set(def.map(() => Math.round((r() * 4 - 2) * 10) / 10)); }
      if (a) render();
    });
    set(def);
    onResize(render);
  }

  /* ---------- Fig 4: training on XOR ---------- */
  {
    const root = $('#fig-train'), k = n => $(`[data-k=${n}]`, root), grid = $('[data-role=grid]', root);
    const X = [[0, 0], [0, 1], [1, 0], [1, 1]], T = [[0], [1], [1], [0]];
    const pl = plane($('[data-role=plane]', root), { aspect: 1 });
    const lossPlot = plot($('[data-role=loss]', root), { aspect: 0.45, x: [0, 1], y: [0, 0.5], xlabel: 'Epoch' });
    const gradPlot = plot($('[data-role=grad]', root), { aspect: 0.45, x: [0, 1], y: [-8, 0], log: true, zeroLine: true, xlabel: 'Epoch' });
    let S, raf = 0, sweep = null;
    const cfg = () => {
      const act = k('act').value, H = Math.max(1, Math.min(8, Math.round(num(k('H')))));
      return { act, H, out: act === 'step' ? 'step' : 'sigmoid', lr: num(k('lr')), epochs: Math.max(1, Math.round(num(k('epochs')))), seed: Math.max(1, Math.round(num(k('seed')))) };
    };
    const settingsText = c => `Dataset XOR (4 points) · network 2-${c.H}-1, ${NN.paramCount([2, c.H, 1])} parameters · hidden ${c.act}, output ${c.out} · loss MSE · full-batch gradient descent, learning rate ${c.lr} · ${c.epochs} epochs · init U(±1/√fan_in)`;
    const correct = net => X.filter((x, i) => (NN.out(net, x) > 0.5 ? 1 : 0) === T[i][0]).length;
    function reset() {
      cancelAnimationFrame(raf); raf = 0;
      const c = cfg(), net = NN.mlp([2, c.H, 1], c.act, c.out, c.seed);
      S = { c, net, opt: NN.optimizer(net, 'gd', c.lr), epoch: 0, loss: [], g1: [], g2: [], last: NN.grad(net, X, T) };
      $('[data-act=train]', root).textContent = 'Train';
      markSeed();
      render();
    }
    function epoch() {
      const g = NN.grad(S.net, X, T), [g1, g2] = NN.layerNorms(g);
      S.loss.push(g.loss); S.g1.push(g1); S.g2.push(g2); S.last = g;
      S.opt(g); S.epoch++;
    }
    function render() {
      const { net, c } = S;
      pl.draw({ heat: (a, b) => NN.out(net, [a, b]), res: 5, contour: c.act !== 'step', points: X.map((x, i) => ({ x: x[0], y: x[1], label: T[i][0], mis: (NN.out(net, x) > 0.5 ? 1 : 0) !== T[i][0] })) });
      const xs = S.loss.map((_, i) => i), E = Math.max(c.epochs, 1), gs = [...S.g1, ...S.g2];
      lossPlot([{ xs, ys: S.loss, color: C.ink }], { x: [0, E], y: [0, Math.max(0.3, ...S.loss.map(v => Math.ceil(v * 10) / 10 + 0.1))] });
      gradPlot([{ xs, ys: S.g1, color: C.plum }, { xs, ys: S.g2, color: C.ochre }], { x: [0, E], y: logRange(gs), hasZero: gs.includes(0) });
      const [n1, n2] = NN.layerNorms(S.last), z = v => (v === 0 ? '0 <small>exactly</small>' : fmt(v)), ok = correct(net);
      $('[data-role=now]', root).innerHTML = cell('Epoch', `${S.epoch}<small>/${c.epochs}</small>`) + cell('Loss (MSE)', fmt(S.last.loss, 4)) + cell('Correct', `${ok}<small>/4</small>`, ok === 4 ? 'good' : '')
        + cell('Hidden gradient', z(n1), n1 === 0 ? 'bad' : '') + cell('Output gradient', z(n2), n2 === 0 ? 'bad' : '');
      $('[data-role=now-settings]', root).textContent = `${settingsText(c)} · seed ${c.seed}`;
      label($('[data-role=plane]', root), `After ${S.epoch} epochs the network gets ${ok} of 4 XOR cases right.`);
      label($('[data-role=loss]', root), `Loss ${fmt(S.last.loss, 4)} after ${S.epoch} of ${c.epochs} epochs.`);
      label($('[data-role=grad]', root), `Gradient size: hidden layer ${n1 === 0 ? 'exactly 0' : fmt(n1)}, output layer ${n2 === 0 ? 'exactly 0' : fmt(n2)}.`);
    }
    function train() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; $('[data-act=train]', root).textContent = 'Train'; return; }
      if (S.epoch >= S.c.epochs) reset();
      $('[data-act=train]', root).textContent = 'Pause';
      const per = Math.max(1, Math.ceil(S.c.epochs / 240));
      const tick = () => {
        for (let i = 0; i < per && S.epoch < S.c.epochs; i++) epoch();
        S.last = NN.grad(S.net, X, T);
        render();
        if (S.epoch < S.c.epochs) raf = requestAnimationFrame(tick);
        else { raf = 0; $('[data-act=train]', root).textContent = 'Train'; }
      };
      raf = requestAnimationFrame(tick);
    }
    const sig = c => JSON.stringify({ ...c, seed: 0 });
    const markSeed = () => $$('button', grid).forEach((b, i) => b.classList.toggle('cur', sweep && sig(S.c) === sweep.sig && i + 1 === S.c.seed));
    function seeds() {
      const c = cfg(), N = 100, box = $('[data-role=seeds]', root), btn = $('[data-act=seeds]', root);
      let s = 1, solved = 0, atInit = 0;
      btn.disabled = true;
      sweep = { sig: sig(c), ok: [] };
      grid.innerHTML = Array.from({ length: N }, (_, i) => `<button type="button" title="Seed ${i + 1}" aria-label="Seed ${i + 1}"></button>`).join('');
      const cellsEl = $$('button', grid);
      const chunk = () => {
        const t0 = performance.now();
        while (s <= N && performance.now() - t0 < 30) {
          const net = NN.mlp([2, c.H, 1], c.act, c.out, s), opt = NN.optimizer(net, 'gd', c.lr);
          if (correct(net) === 4) atInit++;
          for (let e = 0; e < c.epochs; e++) opt(NN.grad(net, X, T));
          const ok = correct(net) === 4;
          if (ok) solved++;
          sweep.ok[s] = ok;
          cellsEl[s - 1].classList.toggle('ok', ok);
          cellsEl[s - 1].title = `Seed ${s}: ${ok ? 'reached zero error' : 'did not reach zero error'}. Click to load.`;
          s++;
        }
        box.innerHTML = s <= N ? `Running seed ${s} of ${N}…` :
          `<span class="big">${solved} of ${N}</span> random starts solved XOR, getting all four points right. ${atInit} of ${N} already had them right before training. Filled squares solved it. Click any square to train that start above.<details class="settings"><summary>Exact settings</summary>${settingsText(c)} · seeds 1–${N} · solved = all four points on the correct side of 0.5 after the last epoch</details>`;
        if (s <= N) setTimeout(chunk, 0); else { btn.disabled = false; markSeed(); }
      };
      chunk();
    }
    grid.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      k('seed').value = $$('button', grid).indexOf(b) + 1;
      reset(); train();
    });
    root.addEventListener('click', e => {
      const a = e.target.closest('button')?.dataset.act;
      if (a === 'train') train(); else if (a === 'reset') reset(); else if (a === 'seeds') seeds();
    });
    $$('[data-k]', root).forEach(el => el.addEventListener('change', reset));
    reset();
    onResize(render);
  }

  /* ---------- Fig 5: universal approximation, construct vs train ---------- */
  {
    const root = $('#fig-uat'), k = n => $(`[data-k=${n}]`, root), cv = $('canvas', root);
    const draw = plot(cv, { aspect: 0.5, x: [0, 1], y: [-1.3, 1.3], xlabel: 'x' });
    const grid = Array.from({ length: 1001 }, (_, i) => i / 1000), pgrid = grid.filter((_, i) => i % 2 === 0);
    const trainX = Array.from({ length: 200 }, (_, i) => [i / 199]);
    let mode = 'construct', drawn = Array.from({ length: 101 }, (_, i) => Math.sin((2 * Math.PI * i) / 100)), trained = null, raf = 0, painting = false;
    const target = () => {
      const t = k('target').value;
      if (t === 'draw') return x => { const u = Math.min(100, Math.max(0, x * 100)), i = Math.min(99, Math.floor(u)); return drawn[i] + (u - i) * (drawn[i + 1] - drawn[i]); };
      return t === 'sawtooth' ? NN.targets.sawtooth(3) : NN.targets[t]();
    };
    const tcfg = () => ({ target: k('target').value, targetName: k('target').selectedOptions[0].textContent, n: +k('n').value, act: k('act').value, lr: num(k('lr')), epochs: Math.max(1, Math.round(num(k('epochs')))), seed: Math.max(1, Math.round(num(k('seed')))), drawnSig: k('target').value === 'draw' ? drawn.join() : '' });
    const sameCfg = (a, b) => a && JSON.stringify(a) === JSON.stringify(b);
    const mse = (f, g) => grid.reduce((s, x) => s + (f(x) - g(x)) ** 2, 0) / grid.length;
    function render() {
      const f = target(), n = +k('n').value, drawing = k('target').value === 'draw';
      $('[data-out=n]', root).textContent = n;
      $('[data-role=train-controls]', root).style.display = mode === 'train' ? '' : 'none';
      $$('[data-mode]', root).forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === mode));
      cv.style.cursor = drawing ? 'crosshair' : 'default';
      const con = NN.constructRelu(f, n), conF = x => NN.out(con.net, [x]), conMSE = mse(f, conF);
      const fresh = trained && sameCfg(trained.cfg, tcfg());
      const series = [{ xs: pgrid, ys: pgrid.map(f), color: C.gray, width: 3 }];
      if (mode === 'construct') series.push({ xs: pgrid, ys: pgrid.map(conF), color: C.plum, dots: con.knots.map(x => [x, conF(x)]) });
      else if (trained) series.push({ xs: pgrid, ys: pgrid.map(x => NN.out(trained.net, [x])), color: C.plum, alpha: fresh ? 1 : 0.35 });
      draw(series);
      $('[data-role=hint]', root).textContent = drawing ? 'Drag across the chart to draw your own target.' : mode === 'train' && !trained ? 'Press Train to fit this width by gradient descent.' : '';
      label(cv, `Target: ${k('target').selectedOptions[0].textContent}. Built by hand with ${n} units, MSE ${fmt(conMSE, 4)}.${trained ? ` Learned version, MSE ${fmt(trained.mse, 4)}.` : ''}`);
      const tc = trained?.cfg;
      // only the numbers are rebuilt each frame; the settings toggle stays put so it doesn't snap shut mid-training
      $('[data-role=uat-main]', root).innerHTML = `<div class="cells" style="margin:0 0 8px">${cell(`Built by hand, ${n} units`, fmt(conMSE, 4) + '<small> MSE</small>')}${cell(trained ? `Learned, ${tc.n} units` : 'Learned', trained ? fmt(trained.mse, 4) + '<small> MSE</small>' : '<small>not run yet</small>', trained && !fresh ? 'bad' : '')}</div>`
        + (trained ? `${trained.done ? '' : `Epoch ${trained.epoch} of ${tc.epochs}, still running. `}${fresh ? '' : '<span class="bad">Settings have changed since this run. Press Train to run it again.</span>'}` : '');
      $('[data-role=uat-set]', root).hidden = !trained;
      if (trained) $('[data-role=uat-set-text]', root).textContent = `Target ${tc.targetName}, network 1-${tc.n}-1 (${NN.paramCount([1, tc.n, 1])} parameters), ${tc.act}, 200 evenly spaced points, full-batch Adam, learning rate ${tc.lr}, ${tc.epochs} epochs, seed ${tc.seed}, init U(±1/√fan_in)`;
    }
    function train() {
      cancelAnimationFrame(raf);
      const c = tcfg(), f = target(), T = trainX.map(x => [f(x[0])]), net = NN.mlp([1, c.n, 1], c.act, 'identity', c.seed), opt = NN.optimizer(net, 'adam', c.lr);
      trained = { cfg: c, net, epoch: 0, done: false, mse: mse(f, x => NN.out(net, [x])) };
      // animate over at least ~60 frames, but never spend more than ~14 ms of a frame training
      const per = Math.max(1, Math.ceil(c.epochs / 60));
      const tick = () => {
        const t0 = performance.now();
        for (let i = 0; i < per && trained.epoch < c.epochs && (i === 0 || performance.now() - t0 < 14); i++, trained.epoch++) opt(NN.grad(net, trainX, T));
        trained.done = trained.epoch >= c.epochs;
        trained.mse = mse(f, x => NN.out(net, [x]));
        render();
        if (!trained.done) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    const paint = e => {
      const r = cv.getBoundingClientRect(), x = (e.clientX - r.left - 48) / (r.width - 60), y = 1.3 - ((e.clientY - r.top - 10) / (r.height - 52)) * 2.6;
      const i = Math.round(Math.min(1, Math.max(0, x)) * 100), v = Math.min(1.2, Math.max(-1.2, y));
      if (Array.isArray(painting)) { const [pi, pv] = painting, a = Math.min(i, pi), b = Math.max(i, pi); for (let j = a; j <= b; j++) drawn[j] = b === a ? v : pv + ((j - pi) / (i - pi)) * (v - pv); } else drawn[i] = v;
      painting = [i, v];
      render();
    };
    cv.addEventListener('touchstart', e => { if (k('target').value === 'draw') e.preventDefault(); }, { passive: false });
    cv.addEventListener('pointerdown', e => { if (k('target').value !== 'draw') return; cv.setPointerCapture(e.pointerId); painting = true; paint(e); });
    cv.addEventListener('pointermove', e => { if (painting) paint(e); });
    cv.addEventListener('pointerup', () => (painting = false));
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.mode) { mode = b.dataset.mode; render(); }
      if (b.dataset.act === 'train') train();
    });
    $$('[data-k]', root).forEach(el => el.addEventListener('input', render));
    onResize(render);
  }

  /* ---------- Fig 6: tent blocks, exact piece count ---------- */
  {
    const root = $('#fig-tent'), sl = $('[data-k=k]', root), draw = plot($('canvas', root), { aspect: 0.42, x: [0, 1], y: [-0.05, 1.05], xlabel: 'x' });
    const counts = Array.from({ length: 10 }, (_, i) => NN.countPieces(NN.piecewise(NN.tentNet(i + 1))));
    function render() {
      const kk = +sl.value, pl = NN.piecewise(NN.tentNet(kk)), pieces = NN.countPieces(pl), bound = 2 * kk + 1;
      $('[data-out=k]', root).textContent = kk;
      draw([{ xs: pl.xs, ys: pl.ys, color: C.plum, width: kk > 7 ? 1 : 2 }]);
      $('.cells', root).innerHTML = cell('ReLU units used', 2 * kk) + cell('Pieces, stacked', pieces, pieces > bound ? 'good' : '') + cell('Most pieces, one layer', bound);
      label($('canvas', root), `${kk} stacked tent blocks make a zigzag with ${pieces} straight pieces. One hidden layer with the same ${2 * kk} units can make at most ${bound}.`);
      $('tbody', root).innerHTML = counts.map((c, i) => `<tr class="${i + 1 === kk ? 'current' : ''}"><td>${i + 1}</td><td>${2 * (i + 1)}</td><td>${c}</td><td>${2 * (i + 1) + 1}</td></tr>`).join('');
    }
    sl.addEventListener('input', render);
    onResize(render);
  }

  /* ---------- Fig 7, reader view: both networks train live, side by side ---------- */
  {
    const root = $('#fig-exp'), base = { budget: 400, depth: 6, act: 'relu', opt: 'adam', lr: 0.01, epochs: 2000, nTrain: 256, nTest: 1000, dataSeed: 0, seed: 1 };
    const opt = { aspect: 0.62, x: [0, 1], y: [-0.25, 1.25], xlabel: 'x' };
    const draws = { shallow: plot($('[data-role=demo-shallow]', root), opt), deep: plot($('[data-role=demo-deep]', root), opt) };
    const grid = Array.from({ length: 201 }, (_, i) => i / 200), archs = NN.archs(base.budget, base.depth);
    const name = s => (s.length === 3 ? `1-${s[1]}-1` : `1-${s[1]}×${s.length - 2}-1`);
    let teeth = 4, D = null, seen = false;
    $('[data-role=demo-label-shallow]', root).textContent = `Shallow and wide: ${name(archs.shallow)}, ${NN.paramCount(archs.shallow)} parameters`;
    $('[data-role=demo-label-deep]', root).textContent = `Deep and narrow: ${name(archs.deep)}, ${NN.paramCount(archs.deep)} parameters`;
    // shape sketches: every layer is drawn, but the shallow network's 133 units are drawn as a sample
    const sketch = (el, sizes) => {
      const shown = sizes.map((n, i) => (i && i < sizes.length - 1 ? Math.min(n, 14) : n)), dot = { cls: 'dot', r: 3.5 };
      const edges = [];
      for (let c = 0; c + 1 < shown.length; c++) for (let i = 0; i < shown[c]; i++) for (let j = 0; j < shown[c + 1]; j++) edges.push({ a: [c, i], b: [c + 1, j], cls: 'faint' });
      const hidden = sizes.length - 2, label = hidden === 1 ? `1 hidden layer of ${sizes[1]} units (${shown[1]} drawn)` : `${hidden} hidden layers of ${sizes[1]} units`;
      net(el, { h: 132, top: 6, bottom: 24, padX: 12, r: 3.5, aria: `Network shape: ${label}`, cols: shown.map(n => ({ nodes: Array.from({ length: n }, () => dot) })), edges,
        extra: (W, H) => `<text class="title" x="${W / 2}" y="${H - 6}" text-anchor="middle">${label}</text>` });
    };
    onResize(() => { sketch($('[data-role=arch-shallow]', root), archs.shallow); sketch($('[data-role=arch-deep]', root), archs.deep); });
    // training runs in a worker so scrolling and clicks stay smooth on slow phones; it sends a snapshot about 30 times a second
    const src = $('#nn-src').textContent + '\nself.onmessage = e => NN.duel(e.data, s => self.postMessage(s));';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    let worker = null, pending = 0;
    function render() {
      const fn = NN.targets.sawtooth(teeth), tgt = { xs: grid, ys: grid.map(fn), color: C.gray, width: 3 };
      for (const m of ['shallow', 'deep']) draws[m]([tgt, ...(D ? [{ xs: grid, ys: D.nets[m].fit, color: m === 'deep' ? C.plum : C.ochre, width: 2.5 }] : [])]);
      const v = m => (!D ? '–' : fmt(D.done ? D.nets[m].test : D.nets[m].loss, 4));
      $('[data-role=demo-cells]', root).innerHTML = cell('Epoch', `${D ? D.epoch : 0}<small>/${base.epochs}</small>`)
        + cell(D?.done ? 'Shallow, held-out MSE' : 'Shallow, training MSE', v('shallow')) + cell(D?.done ? 'Deep, held-out MSE' : 'Deep, training MSE', v('deep'));
      $('[data-role=demo-settings]', root).textContent = `${NN.formulas.sawtooth(teeth)} · ${base.nTrain} training points, ${base.nTest} held-out · ReLU · full-batch Adam, learning rate ${base.lr} · ${base.epochs} epochs · one random start, seed ${base.seed} · init U(±1/√fan_in)`;
      for (const m of ['shallow', 'deep']) label($(`[data-role=demo-${m}]`, root), `${m === 'deep' ? 'Deep' : 'Shallow'} network's guess at the zigzag after ${D ? D.epoch : 0} epochs. ${D?.done ? 'Held-out' : 'Training'} MSE ${v(m)}.`);
    }
    function play() {
      if (worker) worker.terminate();
      D = null; render();
      worker = new Worker(url);
      worker.onmessage = e => {
        if (STILL && !e.data.done) return; // reduced motion: show only the finished result
        D = e.data;
        if (D.done) { worker.terminate(); worker = null; }
        if (!pending) pending = requestAnimationFrame(() => { pending = 0; render(); });
      };
      worker.postMessage({ ...base, teeth });
    }
    root.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.teeth) { teeth = +b.dataset.teeth; $$('[data-teeth]', root).forEach(x => x.setAttribute('aria-pressed', x === b)); play(); }
      if (b.dataset.act === 'replay') play();
    });
    // starts the first time the figure scrolls into view, so readers see it move without pressing anything
    new IntersectionObserver(([e]) => { if (e.isIntersecting && !seen) { seen = true; play(); } }, { threshold: 0.35 }).observe($('.two', root));
    onResize(render);
  }

  /* ---------- Fig 7: shallow vs deep experiment (Web Worker) ---------- */
  {
    const root = $('#fig-exp'), k = n => $(`[data-k=${n}]`, root), bar = $('.progress > div', root), btn = n => $(`[data-act=${n}]`, root);
    const src = $('#nn-src').textContent + '\nself.onmessage = e => { const r = NN.runExperiment(e.data, p => self.postMessage({ progress: p })); self.postMessage({ result: r }); };';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    let worker = null, result = null;
    const fitShallow = plot($('[data-role=fit-shallow]', root), { aspect: 0.62, x: [0, 1], y: [-0.25, 1.25], xlabel: 'x' });
    const fitDeep = plot($('[data-role=fit-deep]', root), { aspect: 0.62, x: [0, 1], y: [-0.25, 1.25], xlabel: 'x' });
    const curves = plot($('[data-role=curves]', root), { aspect: 0.35, x: [0, 1], y: [-4, 0], log: true, xlabel: 'Epoch' });
    const int = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(num(k(n)))));
    const cfg = () => ({ teeth: int('teeth', 1, 32), budget: int('budget', 20, 5000), depth: int('depth', 2, 16), act: k('act').value, opt: k('opt').value,
      lr: num(k('lr')), epochs: int('epochs', 10, 50000), seeds: int('seeds', 1, 50), nTrain: 256, nTest: 1000, dataSeed: 0 });
    const archName = s => (s.length === 3 ? `1-${s[1]}-1` : `1-${s[1]}×${s.length - 2}-1`);
    function arch() {
      const c = cfg(), a = NN.archs(c.budget, c.depth), ps = NN.paramCount(a.shallow), pd = NN.paramCount(a.deep);
      $('[data-role=arch]', root).innerHTML = `<div class="cells" style="margin:0">${cell(`Shallow ${archName(a.shallow)}`, `${ps}<small> parameters</small>`)}${cell(`Deep ${archName(a.deep)}`, `${pd}<small> parameters</small>`)}</div>`;
    }
    const sum = s => `${fmt(s.mean, 5)} <span style="color:var(--muted)">[${fmt(s.min, 5)}, ${fmt(s.max, 5)}]</span>`;
    function show() {
      if (!result) {
        const msg = worker ? 'Running…' : 'Press Run experiment';
        [fitShallow, fitDeep].forEach(p => p([], { empty: msg })); curves([], { empty: worker ? msg : 'Loss curves appear after a run' });
        return;
      }
      const r = result, s = r.settings, tgt = { xs: r.grid, ys: r.target, color: C.gray, width: 3 };
      const lines = m => r.runs.filter(x => x.model === m).map(x => ({ xs: r.grid, ys: x.fit, color: m === 'deep' ? C.plum : C.ochre, width: 1.3, alpha: 0.75 }));
      fitShallow([tgt, ...lines('shallow')]); fitDeep([tgt, ...lines('deep')]);
      const cs = r.runs.map(x => ({ xs: x.curve.map(p => p[0]), ys: x.curve.map(p => p[1]), color: x.model === 'deep' ? C.plum : C.ochre, width: 1.3, alpha: 0.75 }));
      curves(cs, { x: [0, s.epochs], y: logRange(r.runs.flatMap(x => x.curve.map(p => p[1]))) });
      const row = m => { const q = r.summary[m]; return `<tr><td>${m === 'deep' ? 'Deep' : 'Shallow'}</td><td>${archName(q.sizes)}</td><td>${q.params}</td><td>${sum(q.train)}</td><td>${sum(q.test)}</td></tr>`; };
      $('[data-role=results]', root).innerHTML = `<div class="table-wrap"><table><thead><tr><th>Model</th><th>Architecture</th><th>Parameters</th><th>Train MSE, mean [min, max]</th><th>Held-out MSE, mean [min, max]</th></tr></thead><tbody>${row('shallow')}${row('deep')}</tbody></table></div>
        <details class="settings"><summary>Exact settings</summary>Target ${s.target} · train ${s.trainX} · held-out ${s.testX} · activation ${s.act} (output linear) · optimizer ${s.opt === 'adam' ? 'Adam' : 'gradient descent'}, learning rate ${s.lr}, ${s.batch} · ${s.epochs} epochs · loss ${s.loss} · init ${s.init} · model seeds 1–${s.seeds} · parameter budget ${s.budget}</details>`;
    }
    function run() {
      if (worker) worker.terminate();
      worker = new Worker(url);
      result = null; show();
      $('[data-role=results]', root).textContent = 'Running…';
      bar.style.width = '0';
      btn('run').disabled = true; btn('cancel').disabled = false; btn('json').disabled = btn('csv').disabled = true;
      worker.onmessage = e => {
        if ('progress' in e.data) { bar.style.width = (100 * e.data.progress).toFixed(1) + '%'; return; }
        result = e.data.result; worker.terminate(); worker = null;
        btn('run').disabled = false; btn('cancel').disabled = true; btn('json').disabled = btn('csv').disabled = false;
        show();
      };
      worker.postMessage(cfg());
    }
    function cancel() {
      if (worker) worker.terminate(); worker = null;
      btn('run').disabled = false; btn('cancel').disabled = true; bar.style.width = '0';
      show();
      $('[data-role=results]', root).textContent = 'Cancelled. No results.';
    }
    const save = (text, type, ext) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type }));
      a.download = `shallow-vs-deep-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const toJSON = () => JSON.stringify({ settings: result.settings, summary: result.summary,
      runs: result.runs.map(({ model, sizes, params, seed, trainMSE, testMSE, curve }) => ({ model, architecture: archName(sizes), sizes, params, seed, trainMSE, testMSE, lossCurve: curve })) }, null, 2);
    const toCSV = () => {
      const s = result.settings, head = ['model', 'architecture', 'params', 'seed', 'train_mse', 'heldout_mse', 'teeth', 'budget', 'activation', 'optimizer', 'lr', 'epochs', 'n_train', 'n_heldout', 'data_seed', 'init', 'batch'];
      const q = v => (/[",]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);
      return [head.join(','), ...result.runs.map(r => [r.model, archName(r.sizes), r.params, r.seed, r.trainMSE, r.testMSE, s.teeth, s.budget, s.act, s.opt, s.lr, s.epochs, s.nTrain, s.nTest, s.dataSeed, s.init, s.batch].map(q).join(','))].join('\n');
    };
    root.addEventListener('click', e => {
      const a = e.target.closest('button')?.dataset.act;
      if (a === 'run') run(); else if (a === 'cancel') cancel();
      else if (a === 'json' && result) save(toJSON(), 'application/json', 'json');
      else if (a === 'csv' && result) save(toCSV(), 'text/csv', 'csv');
    });
    $$('[data-k]', root).forEach(el => el.addEventListener('input', arch));
    $('details.advanced', root).addEventListener('toggle', show); // canvases have no width while collapsed
    arch();
    onResize(show);
  }

  /* ---------- section nav and back-to-top ---------- */
  const links = $$('.nav a'), secs = links.map(a => $(a.getAttribute('href')));
  const spy = () => {
    const i = secs.findLastIndex(s => s.getBoundingClientRect().top < innerHeight * 0.35);
    links.forEach((a, j) => a.classList.toggle('active', j === i));
    // the opener is wider than the text column, so the nav waits until it has scrolled away
    const atTop = $('.intro').getBoundingClientRect().bottom > 0;
    $('.nav').classList.toggle('away', atTop);
    $('.to-top').classList.toggle('away', atTop);
  };
  $('.to-top').addEventListener('click', () => scrollTo({ top: 0 }));
  addEventListener('scroll', spy, { passive: true }); spy();
})();
