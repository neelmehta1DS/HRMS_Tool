// directory.js
// Org hierarchy + approval chains, derived directly from the org chart.
//
// `chain` is the ORDERED list of approvers for that person's leave.
//   - [] (empty)  => auto-approved + logged (applies to L2: AD, Abhi)
//   - ['AD']      => single approval (L1 leads, and Abhi's direct reports via Abhi)
//   - ['Nijo','AD'] => two-layer: L1 first, then L2
//
// Routing rules baked in (per the agreed defaults):
//   - Team member:        L1 lead -> L2 (AD)
//   - L1 lead applies:     straight to single L2 (AD)
//   - L2 applies:          auto-approved + logged
//   - Asif / Manoj:        report directly to Abhi, no L1 -> Abhi is sole approver
//   - Aman/Manas/Sarvesh/Arun -> their lead -> AD (chart shows everyone rolling up to AD)

const PEOPLE = {
  // L2 — leadership (peers)
  AD:   { display: 'AD',   role: 'Product Lead',  level: 'L2', chain: [] },
  Abhi: { display: 'Abhi', role: 'Tech Lead',     level: 'L2', chain: [] },

  // L1 — leads (all roll up to AD)
  Thisya: { display: 'Thisya', role: 'PM',            level: 'L1', chain: ['AD'] },
  Sai:    { display: 'Sai',    role: 'PM',            level: 'L1', chain: ['AD'] },
  Achal:  { display: 'Achal',  role: 'PM',            level: 'L1', chain: ['AD'] },
  Juhi:   { display: 'Juhi',   role: 'QA Lead',       level: 'L1', chain: ['AD'] },
  Siya:   { display: 'Siya',   role: 'PM',            level: 'L1', chain: ['AD'] },
  Nijo:   { display: 'Nijo',   role: 'Backend Lead',  level: 'L1', chain: ['AD'] },
  Gautam: { display: 'Gautam', role: 'Backend Lead',  level: 'L1', chain: ['AD'] },
  Vaheed: { display: 'Vaheed', role: 'Frontend Lead', level: 'L1', chain: ['AD'] },

  // Team members
  Neel:    { display: 'Neel',    role: 'Team Member', level: 'M', chain: ['Thisya', 'AD'] },
  Aman:    { display: 'Aman',    role: 'Team Member', level: 'M', chain: ['Nijo', 'AD'] },
  Manas:   { display: 'Manas',   role: 'Team Member', level: 'M', chain: ['Nijo', 'AD'] },
  Sarvesh: { display: 'Sarvesh', role: 'Team Member', level: 'M', chain: ['Vaheed', 'AD'] },
  Arun:    { display: 'Arun',    role: 'Team Member', level: 'M', chain: ['Vaheed', 'AD'] },
  Asif:    { display: 'Asif',    role: 'Team Member', level: 'M', chain: ['Abhi'] },
  Manoj:   { display: 'Manoj',   role: 'Team Member', level: 'M', chain: ['Abhi'] },
};

module.exports = { PEOPLE };
