// Lab catalog: the rooms where samples are given, and every test the hospital lab offers.
// A test is always done in ONE room; the patient's time slot comes from that room's schedule
// (open..close, one slot every `slotMin` minutes, at most `capacity` patients per slot).
// A test may narrow the room's hours with `from` / `to` (e.g. fasting sugar is only taken in the morning).
//
// Result parameters: numeric ones have a reference range (low..high) so the lab desk can flag High / Low;
// text ones (type: 'text') carry the list of `normal` answers, anything else is flagged Abnormal.
// Ranges are common adult reference ranges and are printed on the report as "Ref. range".

export const LAB_CATEGORIES = ['Blood', 'Sugar', 'Urine', 'Stool'];

export const LAB_ROOMS = {
  'L-101': { id: 'L-101', name: 'Blood Collection Room', floor: 'Ground floor, Pathology wing', open: '08:00', close: '13:00', slotMin: 15, capacity: 4 },
  'L-102': { id: 'L-102', name: 'Sugar Test Room', floor: 'Ground floor, Pathology wing', open: '07:30', close: '12:30', slotMin: 15, capacity: 4 },
  'L-103': { id: 'L-103', name: 'Urine Sample Room', floor: 'Ground floor, near washrooms', open: '07:30', close: '13:00', slotMin: 10, capacity: 5 },
  'L-104': { id: 'L-104', name: 'Stool & Other Samples Room', floor: 'Ground floor, Pathology wing', open: '08:00', close: '12:00', slotMin: 15, capacity: 3 },
};

const num = (key, name, unit, low, high, dp = 1) => ({ key, name, unit, low, high, dp });
const txt = (key, name, normal = []) => ({ key, name, type: 'text', normal });

export const LAB_TESTS = [
  {
    id: 'cbc', name: 'Complete Blood Count (CBC)', category: 'Blood', sample: 'Blood', room: 'L-101',
    prep: 'No fasting needed.',
    params: [
      num('hb', 'Haemoglobin', 'g/dL', 12, 17.5),
      num('wbc', 'Total WBC count', '/µL', 4000, 11000, 0),
      num('rbc', 'RBC count', 'million/µL', 4, 6, 2),
      num('plt', 'Platelet count', '/µL', 150000, 450000, 0),
      num('pcv', 'Haematocrit (PCV)', '%', 36, 52),
      num('mcv', 'MCV', 'fL', 80, 100),
      num('neu', 'Neutrophils', '%', 40, 75, 0),
      num('lym', 'Lymphocytes', '%', 20, 45, 0),
    ],
  },
  {
    id: 'lipid', name: 'Lipid Profile', category: 'Blood', sample: 'Blood', room: 'L-101',
    prep: 'Fasting for 9–12 hours (water is allowed).',
    params: [
      num('tc', 'Total cholesterol', 'mg/dL', 0, 200, 0),
      num('tg', 'Triglycerides', 'mg/dL', 0, 150, 0),
      num('hdl', 'HDL cholesterol', 'mg/dL', 40, 100, 0),
      num('ldl', 'LDL cholesterol', 'mg/dL', 0, 130, 0),
      num('vldl', 'VLDL cholesterol', 'mg/dL', 2, 30, 0),
    ],
  },
  {
    id: 'lft', name: 'Liver Function Test (LFT)', category: 'Blood', sample: 'Blood', room: 'L-101',
    prep: 'Fasting for 8 hours is preferred.',
    params: [
      num('tbil', 'Total bilirubin', 'mg/dL', 0.2, 1.2),
      num('dbil', 'Direct bilirubin', 'mg/dL', 0, 0.3),
      num('sgot', 'SGOT (AST)', 'U/L', 5, 40, 0),
      num('sgpt', 'SGPT (ALT)', 'U/L', 5, 40, 0),
      num('alp', 'Alkaline phosphatase', 'U/L', 44, 147, 0),
      num('tp', 'Total protein', 'g/dL', 6, 8.3),
      num('alb', 'Albumin', 'g/dL', 3.5, 5),
    ],
  },
  {
    id: 'kft', name: 'Kidney Function Test (KFT)', category: 'Blood', sample: 'Blood', room: 'L-101',
    prep: 'No special preparation. Drink water normally.',
    params: [
      num('urea', 'Blood urea', 'mg/dL', 15, 45, 0),
      num('creat', 'Serum creatinine', 'mg/dL', 0.6, 1.3, 2),
      num('uric', 'Uric acid', 'mg/dL', 3.5, 7.2),
      num('na', 'Sodium', 'mmol/L', 135, 145, 0),
      num('k', 'Potassium', 'mmol/L', 3.5, 5, 1),
    ],
  },
  {
    id: 'thyroid', name: 'Thyroid Profile (T3, T4, TSH)', category: 'Blood', sample: 'Blood', room: 'L-101',
    prep: 'No fasting needed. Take your thyroid tablet after the sample, if you are on one.',
    params: [
      num('t3', 'Total T3', 'ng/dL', 80, 200, 0),
      num('t4', 'Total T4', 'µg/dL', 5, 12),
      num('tsh', 'TSH', 'µIU/mL', 0.4, 4, 2),
    ],
  },
  {
    id: 'dengue', name: 'Dengue NS1 Antigen', category: 'Blood', sample: 'Blood', room: 'L-101',
    prep: 'No preparation. Best done within the first 5 days of fever.',
    params: [txt('ns1', 'Dengue NS1 antigen', ['negative', 'non reactive', 'non-reactive'])],
  },
  {
    id: 'malaria', name: 'Malaria Parasite (MP) Test', category: 'Blood', sample: 'Blood', room: 'L-101',
    prep: 'No preparation. Come while you have fever, if possible.',
    params: [txt('mp', 'Malaria parasite', ['negative', 'not seen', 'absent'])],
  },

  {
    id: 'fbs', name: 'Blood Sugar – Fasting (FBS)', category: 'Sugar', sample: 'Blood (finger-prick / vein)', room: 'L-102', from: '07:30', to: '10:30',
    prep: 'Fast for 8–10 hours before the test. Only plain water is allowed.',
    params: [num('fbs', 'Fasting blood glucose', 'mg/dL', 70, 99, 0)],
  },
  {
    id: 'ppbs', name: 'Blood Sugar – Post Meal (PPBS)', category: 'Sugar', sample: 'Blood (finger-prick / vein)', room: 'L-102', from: '09:30', to: '12:30',
    prep: 'Eat your normal breakfast, then give the sample exactly 2 hours after the first bite.',
    params: [num('ppbs', 'Post-prandial blood glucose', 'mg/dL', 70, 139, 0)],
  },
  {
    id: 'hba1c', name: 'HbA1c (3-month sugar)', category: 'Sugar', sample: 'Blood', room: 'L-102',
    prep: 'No fasting needed.',
    params: [num('hba1c', 'HbA1c', '%', 4, 5.6)],
  },

  {
    id: 'urine-routine', name: 'Urine Routine & Microscopy', category: 'Urine', sample: 'Urine (mid-stream, first morning sample is best)', room: 'L-103',
    prep: 'Collect a mid-stream sample in the sterile container given at the room. Clean the area before collecting.',
    params: [
      txt('colour', 'Colour', ['pale yellow', 'yellow', 'straw']),
      txt('appearance', 'Appearance', ['clear']),
      num('ph', 'pH', '', 4.6, 8, 1),
      num('sg', 'Specific gravity', '', 1.005, 1.03, 3),
      txt('protein', 'Protein (albumin)', ['nil', 'absent', 'negative']),
      txt('glucose', 'Glucose', ['nil', 'absent', 'negative']),
      txt('ketones', 'Ketones', ['nil', 'absent', 'negative']),
      num('pus', 'Pus cells', '/HPF', 0, 5, 0),
      num('rbcu', 'Red blood cells', '/HPF', 0, 2, 0),
    ],
  },
  {
    id: 'urine-culture', name: 'Urine Culture & Sensitivity', category: 'Urine', sample: 'Urine (clean-catch, sterile container)', room: 'L-103',
    prep: 'Do not take antibiotics before the test unless your doctor says so. Collect a clean mid-stream sample.',
    params: [
      txt('organism', 'Organism isolated', ['no growth', 'nil', 'no organism isolated']),
      txt('count', 'Colony count', []),
      txt('sensitivity', 'Sensitive to', []),
    ],
  },

  {
    id: 'stool-routine', name: 'Stool Routine & Microscopy', category: 'Stool', sample: 'Stool (fresh, in the container given)', room: 'L-104',
    prep: 'Bring a fresh sample (within 1 hour) in the container from the lab counter. Do not mix with urine or water.',
    params: [
      txt('colour', 'Colour', ['brown', 'yellow brown', 'light brown']),
      txt('consistency', 'Consistency', ['formed', 'semi-formed', 'semi formed']),
      txt('mucus', 'Mucus', ['absent', 'nil', 'not seen']),
      txt('blood', 'Blood', ['absent', 'nil', 'not seen']),
      txt('ova', 'Ova / cysts', ['not seen', 'absent', 'nil']),
      num('stpus', 'Pus cells', '/HPF', 0, 5, 0),
    ],
  },
  {
    id: 'stool-occult', name: 'Stool Occult Blood', category: 'Stool', sample: 'Stool (fresh, in the container given)', room: 'L-104',
    prep: 'Avoid red meat and iron tablets for 3 days before, if your doctor allows.',
    params: [txt('occult', 'Occult blood', ['negative', 'absent', 'not detected'])],
  },
];

export const labTestById = (id) => LAB_TESTS.find((t) => t.id === id);
