// leaveRules.js
// Pure validation + date math. No Slack dependencies so it can be unit-tested in isolation.

const dayjs = require('dayjs');

function today() {
  return dayjs().format('YYYY-MM-DD');
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

module.exports = { today, businessDays };
