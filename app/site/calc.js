// Live recalculation for the editable FMEA and reliability panels.
// These mirror rpn(), series(), parallel() and availability() in app/qc.py;
// tests/test_calc_js.mjs checks both give the SPEC section 4 known answers.

// Integer scores 1-10; returns their product or throws on invalid scores.
export function rpn(s, o, d) {
  for (const v of [s, o, d]) {
    if (!Number.isInteger(v) || v < 1 || v > 10) throw new Error("S, O and D must be whole numbers from 1 to 10");
  }
  return s * o * d;
}

function checkR(rs) {
  if (!rs.length) throw new Error("need at least one reliability");
  for (const r of rs) if (!(r >= 0 && r <= 1)) throw new Error("reliabilities must be between 0 and 1");
}

// Independent component probabilities (0-1); probability all succeed.
export function series(...rs) {
  checkR(rs);
  return rs.reduce((a, r) => a * r, 1);
}

// Independent component probabilities (0-1); probability at least one succeeds.
export function parallel(...rs) {
  checkR(rs);
  return 1 - rs.reduce((a, r) => a * (1 - r), 1);
}

// MTBF and MTTR share time units; returns a proportion.
export function availability(mtbf, mttr) {
  if (!(mtbf >= 0 && mttr >= 0) || mtbf + mttr === 0) throw new Error("need MTBF, MTTR >= 0 and not both 0");
  return mtbf / (mtbf + mttr);
}

// Pareto order: descending value with cumulative percent.
// Name/value objects; returns a new sorted array with 0-100 pct and cum_pct.
export function pareto(items) {
  const rows = [...items].sort((a, b) => b.value - a.value);
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (total <= 0) throw new Error("Pareto needs a positive total");
  let run = 0;
  return rows.map((r) => {
    run += r.value;
    return { ...r, pct: (100 * r.value) / total, cum_pct: (100 * run) / total };
  });
}
