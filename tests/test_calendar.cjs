const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/calendar.js'), 'utf8'), context);
for (const [instant, expected] of [
  ['2026-11-07T15:59:59Z', '2026-11-07'],
  ['2026-11-07T16:00:00Z', '2026-11-08'],
  ['2026-12-31T16:00:00Z', '2027-01-01'],
  ['2028-02-28T16:00:00Z', '2028-02-29'],
  ['2026-11-07T23:00:00-08:00', '2026-11-08']
]) {
  assert.equal(vm.runInContext(`calendar.today(new Date('${instant}'))`, context), expected);
}
console.log('Calendar timezone, midnight, year and leap-day checks passed.');
const listeners = {};
const appContext = vm.createContext({
  document: {addEventListener: (name, fn) => { listeners[name] = fn; }},
  window: {addEventListener: (name, fn) => { listeners[name] = fn; }},
  setInterval: (fn, ms) => { assert.equal(ms, 1000); listeners.tick = fn; }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/calendar.js'), 'utf8'), appContext);
const appSource = fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8');
vm.runInContext(appSource.slice(0, appSource.indexOf('function modal(')), appContext);
vm.runInContext("let renders=0; function render(){renders++;} calendar.today=()=> '2026-11-08'; state={today:'2026-11-07'}; currentDate='2026-10-23';", appContext);
listeners.tick();
assert.equal(vm.runInContext('state.today', appContext), '2026-11-08');
assert.equal(vm.runInContext('renders', appContext), 1);
assert.equal(vm.runInContext('currentDate', appContext), '2026-10-23');
vm.runInContext("state.today='2026-11-07'; currentStudent='editing';", appContext);
listeners.focus();
assert.equal(vm.runInContext('renders', appContext), 1);
assert.equal(vm.runInContext('state.today', appContext), '2026-11-08');
vm.runInContext("state.today='2026-11-07'; document.hidden=false;", appContext);
listeners.visibilitychange();
assert.equal(vm.runInContext('state.today', appContext), '2026-11-08');
console.log('Automatic synchronization and historical-date preservation checks passed.');
