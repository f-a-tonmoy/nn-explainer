// Pure math for every interactive. No DOM, so Node tests and the Web Worker load the same file.
(function (root) {
  const NN = {};

  // mulberry32: small seeded PRNG so every run is reproducible from its seed
  NN.rng = seed => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---------- single perceptron ---------- */

  NN.predict = (w, b, x) => (w[0] * x[0] + w[1] * x[1] + b > 0 ? 1 : 0);
  // Inputs live on a 0.05 grid, so exact weight states are reachable; rounding removes float drift.
  const snap = v => Math.round(v * 1e9) / 1e9;

  // Rosenblatt's rule, one example per step, examples in dataset order.
  NN.perceptron = (data, w0, b0) => {
    const s = {
      w: [w0[0], w0[1]], b: b0, i: 0, epoch: 1, updates: 0, epochMistakes: 0,
      status: 'running', cycle: null, seen: new Map(), last: null,
    };
    s.step = () => {
      if (s.status !== 'running' || !data.length) return s;
      const key = `${s.i}|${s.w[0]}|${s.w[1]}|${s.b}`;
      const prev = s.seen.get(key);
      if (prev) {
        // Same weights at the same example: if nothing changed in between, every example was
        // classified correctly for a full pass, so it has converged. Otherwise it is a cycle.
        if (prev.updates === s.updates) { s.status = 'converged'; return s; }
        s.status = 'cycle';
        s.cycle = { example: s.i, firstEpoch: prev.epoch, againEpoch: s.epoch, length: s.updates - prev.updates, w: [...s.w], b: s.b };
        return s;
      }
      s.seen.set(key, { epoch: s.epoch, updates: s.updates });
      const p = data[s.i], yhat = NN.predict(s.w, s.b, [p.x, p.y]);
      const sign = p.label - yhat; // +1: add input, -1: subtract input, 0: do nothing
      if (sign) {
        s.w = [snap(s.w[0] + sign * p.x), snap(s.w[1] + sign * p.y)];
        s.b = snap(s.b + sign);
        s.updates++; s.epochMistakes++;
      }
      s.last = { i: s.i, epoch: s.epoch, yhat, label: p.label, sign, w: [...s.w], b: s.b };
      s.i++;
      if (s.i === data.length) {
        if (s.epochMistakes === 0) s.status = 'converged';
        s.i = 0; s.epoch++; s.epochMistakes = 0;
      }
      return s;
    };
    return s;
  };

  NN.accuracy = (w, b, pts) => pts.filter(p => NN.predict(w, b, [p.x, p.y]) === p.label).length;

  // Best accuracy any single line achieves. The order of projections onto a direction only changes
  // at directions perpendicular to some p_i - p_j, so one direction inside each arc between those
  // critical angles, swept over every threshold, covers every linear split.
  // Returns the count and one line (w, b) that achieves it.
  NN.bestLine = pts => {
    const n = pts.length;
    if (!n) return { correct: 0, w: [1, 0], b: 0 };
    const crit = [0];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
      if (!dx && !dy) continue;
      const a = Math.atan2(dy, dx) + Math.PI / 2;
      for (const t of [a, a + Math.PI]) crit.push(((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    }
    crit.sort((a, b) => a - b);
    crit.push(crit[0] + 2 * Math.PI);
    let best = { correct: -1 };
    const keep = (correct, c, s, thr) => { if (correct > best.correct) best = { correct, w: [c, s], b: -thr }; };
    for (let k = 0; k + 1 < crit.length; k++) {
      if (crit[k + 1] - crit[k] < 1e-12) continue;
      const t = (crit[k] + crit[k + 1]) / 2, c = Math.cos(t), s = Math.sin(t);
      const pr = pts.map(p => ({ v: p.x * c + p.y * s, l: p.label })).sort((a, b) => a.v - b.v);
      // threshold below pr[0]: every point predicted 1; after step m, points 0..m are predicted 0
      let correct = pr.filter(p => p.l === 1).length;
      keep(correct, c, s, pr[0].v - 1);
      for (let m = 0; m < n; m++) {
        correct += pr[m].l === 0 ? 1 : -1;
        if (m + 1 === n) keep(correct, c, s, pr[m].v + 1);
        else if (pr[m + 1].v > pr[m].v) keep(correct, c, s, (pr[m].v + pr[m + 1].v) / 2);
      }
    }
    return best;
  };
  NN.bestLinear = pts => NN.bestLine(pts).correct;

  /* ---------- multilayer perceptron ---------- */

  NN.acts = {
    // Step's slope is zero everywhere it is defined; we use 0 at the threshold too.
    step: { f: z => (z > 0 ? 1 : 0), d: () => 0 },
    sigmoid: { f: z => 1 / (1 + Math.exp(-z)), d: (z, a) => a * (1 - a) },
    tanh: { f: Math.tanh, d: (z, a) => 1 - a * a },
    relu: { f: z => (z > 0 ? z : 0), d: z => (z > 0 ? 1 : 0) },
    identity: { f: z => z, d: () => 1 },
  };

  NN.paramCount = sizes => sizes.slice(1).reduce((s, m, l) => s + (sizes[l] + 1) * m, 0);

  // Init matches PyTorch's nn.Linear default: W and b ~ U(-1/sqrt(fan_in), 1/sqrt(fan_in)).
  NN.mlp = (sizes, hidden, out, seed) => {
    const r = NN.rng(seed), W = [], b = [];
    for (let l = 0; l + 1 < sizes.length; l++) {
      const n = sizes[l], m = sizes[l + 1], k = 1 / Math.sqrt(n);
      W.push(Float64Array.from({ length: m * n }, () => (2 * r() - 1) * k));
      b.push(Float64Array.from({ length: m }, () => (2 * r() - 1) * k));
    }
    return { sizes, W, b, hidden, out };
  };

  // Reuses per-net buffers: training calls this hundreds of thousands of times.
  const buffers = net => net._buf || (net._buf = {
    A: net.sizes.map(n => new Float64Array(n)), Z: net.sizes.slice(1).map(n => new Float64Array(n)),
    D: net.sizes.map(n => new Float64Array(n)),
  });

  NN.forward = (net, x) => {
    const L = net.W.length, { A, Z } = buffers(net);
    for (let i = 0; i < x.length; i++) A[0][i] = x[i];
    for (let l = 0; l < L; l++) {
      const n = net.sizes[l], m = net.sizes[l + 1], W = net.W[l], a = A[l], z = Z[l], o = A[l + 1], bl = net.b[l];
      const f = NN.acts[l === L - 1 ? net.out : net.hidden].f;
      for (let j = 0; j < m; j++) {
        let s = bl[j];
        for (let i = 0, r = j * n; i < n; i++) s += W[r + i] * a[i];
        z[j] = s; o[j] = f(s);
      }
    }
    return { A, Z };
  };

  NN.out = (net, x) => NN.forward(net, x).A[net.W.length][0];

  // Full-batch MSE, L = mean over samples of (y - t)^2, and its exact gradient by backprop.
  NN.grad = (net, X, T) => {
    const L = net.W.length, N = X.length;
    const gW = net.W.map(w => new Float64Array(w.length)), gb = net.b.map(v => new Float64Array(v.length));
    const out = NN.acts[net.out], hid = NN.acts[net.hidden];
    let loss = 0;
    const D = buffers(net).D;
    for (let s = 0; s < N; s++) {
      const { A, Z } = NN.forward(net, X[s]), y = A[L], dL = D[L];
      for (let j = 0; j < y.length; j++) {
        const e = y[j] - T[s][j];
        loss += (e * e) / N;
        dL[j] = ((2 * e) / N) * out.d(Z[L - 1][j], y[j]);
      }
      for (let l = L - 1; l >= 0; l--) {
        const n = net.sizes[l], m = net.sizes[l + 1], W = net.W[l], a = A[l], d = D[l + 1], gw = gW[l], g = gb[l];
        for (let j = 0; j < m; j++) {
          const dj = d[j];
          g[j] += dj;
          for (let i = 0, r = j * n; i < n; i++) gw[r + i] += dj * a[i];
        }
        if (l > 0) {
          const p = D[l], z = Z[l - 1];
          for (let i = 0; i < n; i++) {
            let s2 = 0;
            for (let j = 0; j < m; j++) s2 += W[j * n + i] * d[j];
            p[i] = s2 * hid.d(z[i], a[i]);
          }
        }
      }
    }
    return { loss, gW, gb };
  };

  NN.mse = (net, X, T) => X.reduce((s, x, i) => s + (NN.out(net, x) - T[i][0]) ** 2, 0) / X.length;

  NN.layerNorms = g => g.gW.map((w, l) => Math.sqrt(w.reduce((s, v) => s + v * v, 0) + g.gb[l].reduce((s, v) => s + v * v, 0)));

  // 'gd' is plain gradient descent; 'adam' uses the usual defaults (0.9, 0.999, 1e-8).
  NN.optimizer = (net, type, lr) => {
    const P = [...net.W, ...net.b], m = P.map(p => new Float64Array(p.length)), v = P.map(p => new Float64Array(p.length));
    let t = 0;
    return g => {
      t++;
      const G = [...g.gW, ...g.gb], c1 = 1 - 0.9 ** t, c2 = 1 - 0.999 ** t;
      P.forEach((p, k) => {
        const gk = G[k];
        for (let i = 0; i < p.length; i++) {
          if (type === 'adam') {
            m[k][i] = 0.9 * m[k][i] + 0.1 * gk[i];
            v[k][i] = 0.999 * v[k][i] + 0.001 * gk[i] * gk[i];
            p[i] -= (lr * (m[k][i] / c1)) / (Math.sqrt(v[k][i] / c2) + 1e-8);
          } else p[i] -= lr * gk[i];
        }
      });
    };
  };

  /* ---------- 1D targets and constructions ---------- */

  const frac = x => x - Math.floor(x);
  NN.targets = {
    sine: () => x => Math.sin(2 * Math.PI * x),
    // triangle-wave sawtooth with T teeth on [0, 1]: 0 at the ends, peaks of height 1
    sawtooth: T => x => 1 - Math.abs(2 * frac(T * x) - 1),
    step: () => x => (x < 0.5 ? 0 : 1),
  };
  NN.formulas = {
    sine: 'f(x) = sin(2πx)',
    sawtooth: T => `f(x) = 1 − |2·frac(${T}x) − 1|, ${T} teeth`,
    step: 'f(x) = 0 for x < 0.5, 1 otherwise',
  };

  // One hidden layer, n ReLU units, built directly: the piecewise-linear interpolant of f
  // through knots i/n. Unit i is relu(x - i/n); its output weight is the slope change there.
  NN.constructRelu = (f, n) => {
    const knots = Array.from({ length: n + 1 }, (_, i) => i / n), y = knots.map(f);
    const slope = i => (y[i + 1] - y[i]) * n;
    const net = { sizes: [1, n, 1], hidden: 'relu', out: 'identity',
      W: [new Float64Array(n).fill(1), Float64Array.from({ length: n }, (_, i) => (i ? slope(i) - slope(i - 1) : slope(0)))],
      b: [Float64Array.from({ length: n }, (_, i) => -knots[i]), Float64Array.of(y[0])] };
    return { net, knots };
  };

  // The author's toy construction: a 2-unit ReLU tent block, tent(x) = 2·relu(x) − 4·relu(x − ½),
  // stacked k times. The final 2,−4 combination is folded into the next block's weights.
  NN.tentNet = k => {
    const W = [], b = [];
    for (let l = 0; l < k; l++) {
      W.push(l ? Float64Array.of(2, -4, 2, -4) : Float64Array.of(1, 1));
      b.push(Float64Array.of(0, -0.5));
    }
    W.push(Float64Array.of(2, -4)); b.push(Float64Array.of(0));
    return { sizes: [1, ...Array(k).fill(2), 1], W, b, hidden: 'relu', out: 'identity' };
  };

  // Exact output of a 1D-input ReLU network on [0, 1] as a piecewise-linear function. Every neuron
  // shares one breakpoint grid; each ReLU adds the points where some pre-activation crosses zero.
  NN.piecewise = net => {
    const L = net.W.length;
    let xs = [0, 1], vals = [[0, 1]]; // values of each current-layer unit at xs
    for (let l = 0; l < L; l++) {
      const n = net.sizes[l], m = net.sizes[l + 1], W = net.W[l];
      let z = Array.from({ length: m }, (_, j) => xs.map((_, k) => {
        let s = net.b[l][j];
        for (let i = 0; i < n; i++) s += W[j * n + i] * vals[i][k];
        return s;
      }));
      if (l === L - 1) { vals = z; break; }
      const add = [];
      z.forEach(zj => { for (let k = 0; k + 1 < xs.length; k++) if (zj[k] * zj[k + 1] < 0) add.push(xs[k] + (zj[k] / (zj[k] - zj[k + 1])) * (xs[k + 1] - xs[k])); });
      if (add.length) {
        const nx = [...new Set([...xs, ...add])].sort((a, b) => a - b);
        z = z.map(zj => interp(xs, zj, nx));
        xs = nx;
      }
      vals = z.map(zj => zj.map(v => (v > 0 ? v : 0)));
    }
    return { xs, ys: vals[0] };
  };

  function interp(xs, ys, nx) {
    let k = 0;
    return nx.map(x => {
      while (k + 2 < xs.length && xs[k + 1] < x) k++;
      const t = (x - xs[k]) / (xs[k + 1] - xs[k]);
      return ys[k] + t * (ys[k + 1] - ys[k]);
    });
  }

  // Linear pieces = 1 + number of breakpoints where the slope actually changes.
  NN.countPieces = ({ xs, ys }) => {
    let pieces = 0, prev = null;
    for (let k = 0; k + 1 < xs.length; k++) {
      const dx = xs[k + 1] - xs[k];
      if (dx <= 0) continue;
      const s = (ys[k + 1] - ys[k]) / dx;
      if (prev === null || Math.abs(s - prev) > 1e-9 * (1 + Math.abs(s) + Math.abs(prev))) pieces++;
      prev = s;
    }
    return pieces;
  };

  /* ---------- shallow vs deep experiment ---------- */

  // Shallow 1-h-1 has 3h+1 parameters. Deep 1-w-…-w-1 with D hidden layers has
  // (D-1)w² + (D+2)w + 1. Each width is the integer closest to the budget.
  NN.archs = (budget, depth) => {
    const h = Math.max(1, Math.round((budget - 1) / 3));
    const a = depth - 1, bq = depth + 2, c = 1 - budget;
    const w = Math.max(1, Math.round((-bq + Math.sqrt(bq * bq - 4 * a * c)) / (2 * a)));
    return { shallow: [1, h, 1], deep: [1, ...Array(depth).fill(w), 1] };
  };

  NN.summary = v => ({ mean: v.reduce((s, x) => s + x, 0) / v.length, min: Math.min(...v), max: Math.max(...v) });

  NN.runExperiment = (cfg, progress) => {
    const f = NN.targets.sawtooth(cfg.teeth), rd = NN.rng(cfg.dataSeed), rt = NN.rng(cfg.dataSeed + 1);
    const Xtr = Array.from({ length: cfg.nTrain }, () => [rd()]), Ttr = Xtr.map(x => [f(x[0])]);
    const Xte = Array.from({ length: cfg.nTest }, () => [rt()]), Tte = Xte.map(x => [f(x[0])]);
    const grid = Array.from({ length: 401 }, (_, i) => i / 400);
    const archs = NN.archs(cfg.budget, cfg.depth), runs = [], every = Math.max(1, Math.floor(cfg.epochs / 100));
    const total = 2 * cfg.seeds * cfg.epochs;
    let done = 0;
    for (const model of ['shallow', 'deep']) {
      for (let seed = 1; seed <= cfg.seeds; seed++) {
        const net = NN.mlp(archs[model], cfg.act, 'identity', seed), step = NN.optimizer(net, cfg.opt, cfg.lr), curve = [];
        for (let e = 0; e < cfg.epochs; e++) {
          const g = NN.grad(net, Xtr, Ttr);
          if (e % every === 0) curve.push([e, g.loss]);
          step(g);
          if (progress && ++done % 200 === 0) progress(done / total);
        }
        if (progress && done % 200) progress(done / total);
        runs.push({ model, sizes: archs[model], params: NN.paramCount(archs[model]), seed,
          trainMSE: NN.mse(net, Xtr, Ttr), testMSE: NN.mse(net, Xte, Tte), curve, fit: grid.map(x => NN.out(net, [x])) });
      }
    }
    const summary = {};
    for (const model of ['shallow', 'deep']) {
      const r = runs.filter(x => x.model === model);
      summary[model] = { sizes: archs[model], params: r[0].params, train: NN.summary(r.map(x => x.trainMSE)), test: NN.summary(r.map(x => x.testMSE)) };
    }
    return { settings: { ...cfg, target: NN.formulas.sawtooth(cfg.teeth), init: 'U(±1/√fan_in) for W and b', batch: 'full batch', loss: 'MSE',
      trainX: `${cfg.nTrain} points ~ U[0,1], data seed ${cfg.dataSeed}`, testX: `${cfg.nTest} points ~ U[0,1], data seed ${cfg.dataSeed + 1}` },
      grid, target: grid.map(f), runs, summary };
  };

  // Trains the shallow and the deep network side by side on one seed, calling snap(state) about every
  // `every` ms so a page can animate it. Same data and init as runExperiment, so seed-1 numbers match.
  NN.duel = (cfg, snap, every = 33) => {
    const f = NN.targets.sawtooth(cfg.teeth), rd = NN.rng(cfg.dataSeed), rt = NN.rng(cfg.dataSeed + 1);
    const X = Array.from({ length: cfg.nTrain }, () => [rd()]), T = X.map(x => [f(x[0])]);
    const Xt = Array.from({ length: cfg.nTest }, () => [rt()]), Tt = Xt.map(x => [f(x[0])]);
    const grid = Array.from({ length: 201 }, (_, i) => i / 200), archs = NN.archs(cfg.budget, cfg.depth);
    const nets = ['shallow', 'deep'].map(m => { const net = NN.mlp(archs[m], cfg.act, 'identity', cfg.seed); return { m, net, step: NN.optimizer(net, cfg.opt, cfg.lr), loss: NN.mse(net, X, T) }; });
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const shot = (epoch, done) => ({ epoch, done, nets: Object.fromEntries(nets.map(n => [n.m, { loss: n.loss, fit: grid.map(x => NN.out(n.net, [x])), test: done ? NN.mse(n.net, Xt, Tt) : null }])) });
    snap(shot(0, false));
    let t = now();
    for (let e = 1; e <= cfg.epochs; e++) {
      for (const n of nets) { const g = NN.grad(n.net, X, T); n.loss = g.loss; n.step(g); }
      if (e < cfg.epochs && now() - t >= every) { snap(shot(e, false)); t = now(); }
    }
    const last = shot(cfg.epochs, true);
    snap(last);
    return last;
  };

  if (typeof module !== 'undefined') module.exports = NN;
  else root.NN = NN;
})(typeof self !== 'undefined' ? self : this);
