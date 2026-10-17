// Check routing and data-independent help with a small DOM stand-in.
// Run from the repository root: node app/check_h09.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const elements = new Map();
const element = (id) => {
  if (!elements.has(id)) elements.set(id, {
    innerHTML: '', textContent: '', hidden: false,
    toggleAttribute() {}, focus() {},
  });
  return elements.get(id);
};
const context = vm.createContext({
  document: { querySelector: element, addEventListener() {} },
  localStorage: { getItem() { return null; } },
  location: { hash: '' }, console,
});
const source = fs.readFileSync('app/site/app.js', 'utf8')
  .replace('import { rpn, pareto } from "./calc.js";', '')
  .replace(/^init\(\);$/m, '');
vm.runInContext(source, context);
vm.runInContext(`
  if (PAGES.slice(-2).map(p => p.id).join(',') !== 'docs,about') throw Error('Tab order');
  S.error = 'No dataset'; S.loading = true;
  location.hash = '#docs'; route();
`, context);
assert.match(element('#page').innerHTML, /Using Dock Watch as an analyst/);
assert.match(element('#nav').innerHTML, /href="#docs" aria-current="page"/);
vm.runInContext("location.hash = '#about'; route();", context);
assert.match(element('#page').innerHTML, /Meet The Team!/);
assert.match(element('#nav').innerHTML, /href="#about" aria-current="page"/);
for (const [name, image] of [
  ['Zoe Bishop', 'zoe-bishop'], ['Allison Lou', 'allison-lou'],
  ['Liliana Nasrallah', 'liliana-nasrallah'], ['Joanna Tan', 'joanna-tan'],
]) {
  assert.ok(element('#page').innerHTML.includes(name));
  assert.ok(fs.statSync(`app/site/images/${image}.jpg`).size > 0);
}
// Exercise the illustrated guide with every real bundled synthetic snapshot.
for (const dataset of JSON.parse(fs.readFileSync('app/site/data/index.json', 'utf8'))) {
  context.fixture = JSON.parse(fs.readFileSync(`app/site/data/${dataset.id}.json`, 'utf8'));
  for (const snapshot of context.fixture.meta.snapshots) {
    context.snapshotLabel = snapshot;
    vm.runInContext(`S.data = fixture; S.snap = snapshotLabel; S.loading = false;
      S.error = null; location.hash = '#docs'; route();`, context);
    assert.match(element('#page').innerHTML, /Your network at a glance/);
    assert.match(element('#page').innerHTML, /docs-forecast/);
    assert.match(element('#page').innerHTML, /Heatmap of/);
    assert.match(element('#page').innerHTML, /read the dock tracker/);
    assert.match(element('#page').innerHTML, /id="leaflet"/);
    assert.match(element('#page').innerHTML, /Key formulas, explained/);
    assert.doesNotMatch(element('#page').innerHTML, /at least max\(3/);
    assert.ok(element('#page').innerHTML.includes(context.fixture.snapshots[snapshot].forecast[0].id));
    assert.doesNotMatch(element('#page').innerHTML, />undefined<|NaN|color:undefined/);
  }
}
const html = fs.readFileSync('app/site/index.html', 'utf8');
assert.match(html, /<header class="site-header">/);
assert.doesNotMatch(html, /id="collapse"|<aside/);
const css = fs.readFileSync('app/site/styles.css', 'utf8');
assert.match(css, /\.shell \{[^}]*flex-direction: column/);
assert.doesNotMatch(css, /\.sidebar|\.collapsed|nav a span \{ display: none/);
assert.ok(fs.readFileSync('docs/TOOL_GUIDE.md', 'utf8').includes('forecast_bikes('));
console.log('H-09 static checks PASS');
