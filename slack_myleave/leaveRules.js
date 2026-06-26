// leaveRules.js
// Pure validation + date math. No Slack dependencies so it can be unit-tested in isolation.

const dayjs = require('dayjs');

// Tweakable policy in one place.
const RULES = {
  casual: {
    singleDayMinAdvance: 1, // single-day casual: apply >= 1 day ahead
    multiDayMinAdvance: 5,  // multi-day casual: apply >= 5 days ahead
  },
};

function today() {
  return dayjs().format('YYYY-MM-DD');
}

function diffDays(fromStr, toStr) {
  return dayjs(toStr).startOf('day').diff(dayjs(fromStr).startOf('day'), 'day');
}

// Count working days in [start, end] inclusive, excluding weekends and holidays.
function businessDays(startStr, endStr, holidaySet) {
  let count = 0;
  let d = dayjs(startStr).startOf('day');
  const end = dayjs(endStr).startOf('day');
  while (d.isSame(end) || d.isBefore(end)) {
    const dow = d.day(); // 0 Sun .. 6 Sat
    const iso = d.format('YYYY-MM-DD');
    if (dow !== 0 && dow !== 6 && !holidaySet.has(iso)) count++;
    d = d.add(1, 'day');
  }
  return count;
}

// Returns { ok, errors: {blockId: msg}, days, isMulti }
function validate({ type, start, end, balances, holidaySet, now = today() }) {
  const errors = {};

  if (!start) {
    errors.start = 'Pick a start date.';
    return { ok: false, errors, days: 0, isMulti: false };
  }
  const effectiveEnd = end || start;

  if (dayjs(effectiveEnd).isBefore(dayjs(start))) {
    errors.end = "End date can't be before the start date.";
  }

  const isMulti = diffDays(start, effectiveEnd) >= 1;

  if (type === 'sick') {
    if (start !== now || effectiveEnd !== now) {
      errors.start = 'Sick leave can only be applied for today.';
    }
  } else if (type === 'casual') {
    const advance = diffDays(now, start);
    if (!isMulti) {
      const min = RULES.casual.singleDayMinAdvance;
      if (advance < min) {
        const earliest = dayjs(now).add(min, 'day').format('YYYY-MM-DD');
        errors.start = `Casual leave (single day) needs at least ${min} day notice. Earliest you can pick is ${earliest}.`;
      }
    } else {
      const min = RULES.casual.multiDayMinAdvance;
      if (advance < min) {
        const earliest = dayjs(now).add(min, 'day').format('YYYY-MM-DD');
        errors.start = `Casual leave (multi-day) needs at least ${min} days notice. Earliest start is ${earliest}.`;
      }
    }
  } else {
    errors.type = 'Pick a leave type.';
  }

  // Balance check (only if dates are otherwise sane)
  let days = 0;
  if (!errors.end) {
    days = businessDays(start, effectiveEnd, holidaySet);
    if (days <= 0) {
      errors.start = 'That range has no working days (weekend/holiday only).';
    } else if (balances && days > balances[type]) {
      errors.start = `Not enough ${type} balance: this needs ${days} working day(s), you have ${balances[type]}.`;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, days, isMulti };
}

module.exports = { RULES, today, diffDays, businessDays, validate };
