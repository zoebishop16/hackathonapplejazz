// node tests/test_calc_js.mjs : the browser calculator gives the SPEC section 4 answers.
import assert from "node:assert/strict";
import { rpn, series, parallel, availability, pareto } from "../app/site/calc.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
assert.equal(rpn(8, 5, 3), 120);
assert.throws(() => rpn(0, 5, 3));
assert.throws(() => rpn(5.5, 5, 3));
close(series(0.9, 0.8), 0.72);
close(parallel(0.9, 0.8), 0.98);
close(availability(95, 5), 0.95);
assert.throws(() => availability(0, 0));
assert.throws(() => series(1.2));
const p = pareto([{ name: "a", value: 20 }, { name: "b", value: 60 }, { name: "c", value: 20 }]);
assert.deepEqual(p.map((r) => r.name), ["b", "a", "c"]);
assert.equal(p[0].cum_pct, 60);
assert.equal(p[2].cum_pct, 100);
console.log("calc.js: 12 checks passed");
