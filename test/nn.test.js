// Self-checks for the math behind every interactive. Run: node --test perceptrons/test
const test = require('node:test');
const assert = require('node:assert');
const NN = require('../src/nn.js');

const pts = (labels) => [[0, 0], [0, 1], [1, 0], [1, 1]].map(([x, y], i) => ({ x, y, label: labels[i] }));
const OR = pts([0, 1, 1, 1]), XOR = pts([0, 1, 1, 0]), AND = pts([0, 0, 0, 1]);
const run = (data, w = [0, 0], b = 0) => { const s = NN.perceptron(data, w, b); for (let k = 0; k < 1e5 && s.status === 'running'; k++) s.step(); return s; };

test('perceptron converges on OR and AND, and the result separates the data', () => {
  for (const d of [OR, AND]) {
    const s = run(d);
    assert.equal(s.status, 'converged');
    assert.equal(NN.accuracy(s.w, s.b, d), 4);
  }
});

test('perceptron cycles on XOR from several starts, and the repeated state is real', () => {
  for (const [w, b] of [[[0, 0], 0], [[0.3, -0.7], 0.15], [[2, 2], -1]]) {
    const s = run(XOR, w, b);
    assert.equal(s.status, 'cycle');
    assert.ok(s.cycle.length > 0);
    assert.ok(NN.accuracy(s.w, s.b, XOR) < 4);
  }
});

test('best single line: XOR 3/4, OR 4/4, random separable 100%', () => {
  assert.equal(NN.bestLinear(XOR), 3);
  assert.equal(NN.bestLinear(OR), 4);
  const r = NN.rng(7), P = Array.from({ length: 30 }, () => { const x = r(), y = r(); return { x, y, label: 0.8 * x - y + 0.1 > 0 ? 1 : 0 }; });
  assert.equal(NN.bestLinear(P), 30);
  for (const d of [XOR, OR, AND, P]) { const L = NN.bestLine(d); assert.equal(NN.accuracy(L.w, L.b, d), L.correct); }
});

test('backprop matches finite differences (sigmoid, tanh, relu)', () => {
  const X = [[0, 0], [0, 1], [1, 0], [1, 1]], T = [[0], [1], [1], [0]];
  for (const act of ['sigmoid', 'tanh', 'relu']) {
    const net = NN.mlp([2, 3, 3, 1], act, act === 'relu' ? 'identity' : 'sigmoid', 5);
    const g = NN.grad(net, X, T), h = 1e-6;
    net.W.forEach((W, l) => W.forEach((_, i) => {
      const o = W[i]; W[i] = o + h; const lp = NN.grad(net, X, T).loss; W[i] = o - h; const lm = NN.grad(net, X, T).loss; W[i] = o;
      assert.ok(Math.abs((lp - lm) / (2 * h) - g.gW[l][i]) < 1e-6, `${act} W${l}[${i}]`);
    }));
  }
});

test('step network: every gradient is exactly zero and training leaves the loss unchanged', () => {
  const X = [[0, 0], [0, 1], [1, 0], [1, 1]], T = [[0], [1], [1], [0]];
  const net = NN.mlp([2, 2, 1], 'step', 'step', 3), step = NN.optimizer(net, 'gd', 1);
  const l0 = NN.grad(net, X, T).loss;
  for (let e = 0; e < 50; e++) { const g = NN.grad(net, X, T); assert.deepEqual(NN.layerNorms(g), [0, 0]); step(g); }
  assert.equal(NN.grad(net, X, T).loss, l0);
});

test('tent block stacked k times has exactly 2^k pieces and equals the sawtooth with 2^(k-1) teeth', () => {
  for (let k = 1; k <= 12; k++) {
    const net = NN.tentNet(k), pl = NN.piecewise(net);
    assert.equal(NN.countPieces(pl), 2 ** k, `k=${k}`);
    const f = NN.targets.sawtooth(2 ** (k - 1));
    for (let i = 0; i <= 200; i++) assert.ok(Math.abs(NN.out(net, [i / 200]) - f(i / 200)) < 1e-9);
  }
});

test('piecewise propagation agrees with forward pass on random ReLU nets; one hidden layer of n units gives at most n+1 pieces', () => {
  for (let s = 1; s <= 20; s++) {
    const n = 1 + (s % 9), net = NN.mlp([1, n, 4, 1], 'relu', 'identity', s), pl = NN.piecewise(net);
    for (let i = 0; i <= 50; i++) {
      const x = i / 50, k = Math.min(pl.xs.findIndex(v => v >= x), pl.xs.length - 1), j = Math.max(1, k);
      const t = (x - pl.xs[j - 1]) / (pl.xs[j] - pl.xs[j - 1]), y = pl.ys[j - 1] + t * (pl.ys[j] - pl.ys[j - 1]);
      assert.ok(Math.abs(y - NN.out(net, [x])) < 1e-9);
    }
    const shallow = NN.mlp([1, n, 1], 'relu', 'identity', s);
    assert.ok(NN.countPieces(NN.piecewise(shallow)) <= n + 1);
  }
});

test('construct mode interpolates the target at every knot with n units', () => {
  const f = NN.targets.sine();
  for (const n of [1, 4, 17]) {
    const { net, knots } = NN.constructRelu(f, n);
    assert.equal(net.sizes[1], n);
    knots.forEach(x => assert.ok(Math.abs(NN.out(net, [x]) - f(x)) < 1e-9));
  }
});

test('Adam and gradient descent take the textbook steps', () => {
  const one = () => ({ W: [Float64Array.of(1)], b: [Float64Array.of(0)] }), g = v => ({ gW: [Float64Array.of(v)], gb: [Float64Array.of(0)] });
  const net = one(), adam = NN.optimizer(net, 'adam', 0.1);
  adam(g(2)); // m = 0.2, v = 0.004; bias-corrected 2 and 4, so the step is 0.1 · 2 / 2
  assert.ok(Math.abs(net.W[0][0] - 0.9) < 1e-8);
  adam(g(1)); // m = 0.28, v = 0.004996; corrections 1 − 0.9² and 1 − 0.999²
  assert.ok(Math.abs(net.W[0][0] - (0.9 - (0.1 * (0.28 / 0.19)) / Math.sqrt(0.004996 / 0.001999))) < 1e-8);
  const gdNet = one(), gd = NN.optimizer(gdNet, 'gd', 0.5);
  gd(g(2));
  assert.equal(gdNet.W[0][0], 0);
});

test('architectures: parameter counts follow the closed forms and stay near the budget', () => {
  for (const [P, D] of [[100, 2], [400, 6], [1000, 10]]) {
    const a = NN.archs(P, D), w = a.deep[1], h = a.shallow[1];
    assert.equal(NN.paramCount(a.shallow), 3 * h + 1);
    assert.equal(NN.paramCount(a.deep), (D - 1) * w * w + (D + 2) * w + 1);
    assert.ok(Math.abs(NN.paramCount(a.shallow) - P) <= 2);
  }
});

test('the side-by-side demo gives the same held-out error as the full experiment at seed 1', () => {
  const cfg = { teeth: 2, budget: 60, depth: 3, act: 'relu', opt: 'adam', lr: 0.01, epochs: 40, seeds: 1, nTrain: 32, nTest: 32, dataSeed: 0 };
  const full = NN.runExperiment(cfg), shots = [];
  const last = NN.duel({ ...cfg, seed: 1 }, s => shots.push(s), 0);
  assert.equal(last.nets.shallow.test, full.runs.find(r => r.model === 'shallow').testMSE);
  assert.equal(last.nets.deep.test, full.runs.find(r => r.model === 'deep').testMSE);
  assert.ok(shots[0].epoch === 0 && shots.at(-1).done && shots.length > 2);
});

test('experiment runner is deterministic for fixed settings', () => {
  const cfg = { teeth: 2, budget: 60, depth: 3, act: 'relu', opt: 'adam', lr: 0.01, epochs: 30, seeds: 2, nTrain: 32, nTest: 32, dataSeed: 0 };
  const a = NN.runExperiment(cfg), b = NN.runExperiment(cfg);
  assert.deepEqual(a.runs.map(r => r.testMSE), b.runs.map(r => r.testMSE));
  assert.equal(a.runs.length, 4);
});
