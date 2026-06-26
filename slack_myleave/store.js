// store.js
// In-memory state. Resets on restart — fine for a first variation / demo.

const HOLIDAYS_RAW = require('../holidays.json');

const HOLIDAYS = HOLIDAYS_RAW;
const holidaySet = new Set(HOLIDAYS.map((h) => h.date));

module.exports = { HOLIDAYS, holidaySet };
