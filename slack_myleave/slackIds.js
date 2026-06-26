// slackIds.js
// Map each person in the directory to their real Slack member ID (looks like "U0123ABCD").
// You only need these for REAL mode. In DEMO mode they are ignored — every DM goes to you.
//
// To find a user's ID in Slack: click their profile -> ... (More) -> "Copy member ID".
//
// You can also override any of these from the environment without editing this file,
// e.g. SLACK_ID_AD=U0123ABCD  (see resolveSlackId below).

const SLACK_IDS = {
  AD:      'U_FILL_ME',
  Abhi:    'U_FILL_ME',
  Thisya:  'U_FILL_ME',
  Sai:     'U_FILL_ME',
  Achal:   'U_FILL_ME',
  Juhi:    'U_FILL_ME',
  Siya:    'U_FILL_ME',
  Nijo:    'U_FILL_ME',
  Gautam:  'U_FILL_ME',
  Vaheed:  'U_FILL_ME',
  Neel:    'U_FILL_ME',
  Aman:    'U_FILL_ME',
  Manas:   'U_FILL_ME',
  Sarvesh: 'U_FILL_ME',
  Arun:    'U_FILL_ME',
  Asif:    'U_FILL_ME',
  Manoj:   'U_FILL_ME',
};

function resolveSlackId(personName) {
  return process.env[`SLACK_ID_${personName.toUpperCase()}`] || SLACK_IDS[personName] || null;
}

module.exports = { SLACK_IDS, resolveSlackId };
