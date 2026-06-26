// selftest.js — exercises the pure logic without needing Slack tokens.
const dayjs = require('dayjs');
const rules = require('./leaveRules');
const store = require('./store');
const { PEOPLE } = require('./directory');

const t = rules.today();
const plus = (n) => dayjs(t).add(n, 'day').format('YYYY-MM-DD');
let pass = 0, fail = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  cond ? pass++ : fail++;
}

const bal = { sick: 8, casual: 12 };
const hs = store.holidaySet;

// Sick: today ok
check('sick today ok', rules.validate({ type: 'sick', start: t, end: t, balances: bal, holidaySet: hs }).ok);
// Sick: future blocked
check('sick future blocked', !rules.validate({ type: 'sick', start: plus(2), end: plus(2), balances: bal, holidaySet: hs }).ok);
// Sick: backdate blocked
check('sick yesterday blocked', !rules.validate({ type: 'sick', start: plus(-1), end: plus(-1), balances: bal, holidaySet: hs }).ok);
// Casual single day, today -> needs 1 day notice -> blocked
check('casual single same-day blocked', !rules.validate({ type: 'casual', start: t, end: t, balances: bal, holidaySet: hs }).ok);
// Casual single day, +1 -> ok (if not weekend/holiday it counts; pick a far weekday)
const nextWeekday = (() => { let d = dayjs(t).add(1, 'day'); while (d.day() === 0 || d.day() === 6 || hs.has(d.format('YYYY-MM-DD'))) d = d.add(1, 'day'); return d.format('YYYY-MM-DD'); })();
check('casual single +1day ok', rules.validate({ type: 'casual', start: nextWeekday, end: nextWeekday, balances: bal, holidaySet: hs }).ok);
// Casual multi-day, +2 -> blocked (needs 5)
check('casual multi +2days blocked', !rules.validate({ type: 'casual', start: plus(2), end: plus(4), balances: bal, holidaySet: hs }).ok);
// Casual multi-day, +6 -> ok
check('casual multi +6days ok', rules.validate({ type: 'casual', start: plus(6), end: plus(8), balances: bal, holidaySet: hs }).ok);
// End before start
check('end-before-start blocked', !rules.validate({ type: 'casual', start: plus(8), end: plus(6), balances: bal, holidaySet: hs }).ok);
// Balance exceeded
check('over-balance blocked', !rules.validate({ type: 'casual', start: plus(10), end: plus(40), balances: { sick: 8, casual: 2 }, holidaySet: hs }).ok);

// Business-day counting excludes weekends + holidays.
// Oct 2 2026 (Gandhi Jayanti) is a Friday: range Thu Oct1 -> Mon Oct5 = Thu + Mon = 2 (Fri holiday + Sat/Sun excluded).
check('businessDays excludes weekday holiday', rules.businessDays('2026-10-01', '2026-10-05', hs) === 2);

// Chains sanity
check('Neel chain = Thisya,AD', JSON.stringify(PEOPLE.Neel.chain) === JSON.stringify(['Thisya', 'AD']));
check('Siya chain = AD only', JSON.stringify(PEOPLE.Siya.chain) === JSON.stringify(['AD']));
check('Asif chain = Abhi only', JSON.stringify(PEOPLE.Asif.chain) === JSON.stringify(['Abhi']));
check('AD chain empty (auto-approve)', PEOPLE.AD.chain.length === 0);

// Store request lifecycle
const req = store.createRequest({ applicant: 'Neel', type: 'casual', start: plus(6), end: plus(8), days: 3, isMulti: true, reason: 'x', chain: [...PEOPLE.Neel.chain] });
check('request starts pending', req.status === 'pending' && req.currentStep === 0);
const b2 = store.deduct('Neel', 'casual', 3);
check('deduct works', b2.casual === 9);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
