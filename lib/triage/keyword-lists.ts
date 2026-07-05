export interface KeywordConfig {
  terms: string[];
  patterns: RegExp[];
}

export const CRISIS_LIST: KeywordConfig = {
  terms: [
    'suicide',
    'kill myself',
    'end my life',
    'want to die',
    'want to end it',
    'hurt myself',
    'self harm',
    'cutting myself',
    'overdose on purpose',
    'better off dead',
    'commit suicide',
    'wanna die',
    'wanna end it'
  ],
  patterns: [
    /\b(kill|end|harm|cut)\s+(my\s+)?(self|life)\b/i,
    /\bwant\s+to\s+(die|end\s+it)\b/i,
    /\bwanna\s+(die|end\s+it)\b/i,
    /\bcommit\s+suicide\b/i
  ]
};

export const RED_FLAG_LIST: KeywordConfig = {
  terms: [
    'chest pain',
    'cannot breathe',
    'cant breathe',
    'difficulty breathing',
    'shortness of breath',
    'heart attack',
    'stroke',
    'face drooping',
    'slurred speech',
    'severe bleeding',
    'unconscious',
    'passed out',
    'overdose',
    'seizure',
    'convulsion',
    'infant fever',
    'baby not feeding',
    'choking',
    'anaphylaxis',
    'allergic reaction swelling',
    'poisoning',
    'coughing blood',
    'vomiting blood'
  ],
  patterns: [
    /\bchest\s+pain\b/i,
    /\b(cant|can't|cannot)\s+breathe\b/i,
    /\bshort(ness)?\s+of\s+breath\b/i,
    /\bheart\s+attack\b/i,
    /\bface\s+droop(ing)?\b/i,
    /\bslurr(ed)?\s+speech\b/i,
    /\bsevere\s+bleeding\b/i,
    /\bunconscious\b/i,
    /\bpassed\s+out\b/i,
    /\bseizure\b/i,
    /\bconvulsion\b/i,
    /\bcough(ing)?\s+blood\b/i,
    /\bvomit(ing)?\s+blood\b/i
  ]
};

export const RESTRICTED_LIST: KeywordConfig = {
  terms: [
    // Abortifacients & Pidgin/misspelling euphemisms
    'misoprostol',
    'cytotec',
    'mifepristone',
    'mifegyne',
    'abortion pill',
    'pill for abortion',
    'wash belly',
    'wash my belly',
    'flush pregnancy',
    'flush sperm',
    'abort pregnancy',
    'miso',
    'cyto',
    'misoprostol price',
    'cytotec price',
    // Controlled substances & drugs of abuse
    'codeine',
    'tramadol',
    'tramal',
    'rohypnol',
    'roofie',
    'roofies',
    'pentazocine',
    'refnol',
    'diazepam',
    'valium',
    'lexotan',
    'bromazepam',
    'fentanyl',
    'ketamine',
    // Misuse/abuse intent phrases
    'get high',
    'to feel good',
    'feel high',
    'make me high',
    'without prescription',
    'without rx',
    'no prescription',
    'no rx',
    'recreational'
  ],
  patterns: [
    /\bmisoprostol\b/i,
    /\bcytotec\b/i,
    /\bmifepristone\b/i,
    /\bwash\s+(my\s+)?belly\b/i,
    /\bflush\s+(pregnancy|sperm)\b/i,
    /\babortion\s+pill\b/i,
    /\bcodeine\b/i,
    /\btramadol\b/i,
    /\brohypnol\b/i,
    /\brefnol\b/i,
    /\bget\s+high\b/i,
    /\bfeel\s+high\b/i,
    /\bwithout\s+presc\b/i,
    /\bno\s+presc\b/i,
    /\bno\s+rx\b/i
  ]
};

// Common POM drug names/molecules to gate eagerly if matched deterministically
export const POM_MOLECULES_LIST: KeywordConfig = {
  terms: [
    'amoxicillin',
    'augmentin',
    'ciprofloxacin',
    'ciprotab',
    'metronidazole',
    'flagyl',
    'lisinopril',
    'zestril',
    'amlodipine',
    'norvasc',
    'metformin',
    'glucophage',
    'glibenclamide',
    'daonil',
    'insulin',
    'lantus',
    'actrapid',
    'warfarin',
    'atorvastatin',
    'lipitor',
    'losartan',
    'cozaar',
    'sildenafil',
    'viagra',
    'tadalafil',
    'cialis',
    'ventolin',
    'albuterol',
    'salbutamol',
    'prednisolone',
    'dexamethasone'
  ],
  patterns: [
    /\bamoxicillin\b/i,
    /\baugmentin\b/i,
    /\bciprofloxacin\b/i,
    /\bmetronidazole\b/i,
    /\blisinopril\b/i,
    /\bamlodipine\b/i,
    /\bmetformin\b/i,
    /\bglibenclamide\b/i,
    /\binsulin\b/i,
    /\bwarfarin\b/i,
    /\bsildenafil\b/i,
    /\bsalbutamol\b/i,
    /\bprednisolone\b/i,
    /\bdexamethasone\b/i
  ]
};

export const OTC_MOLECULES_LIST: KeywordConfig = {
  terms: [
    'vitamin c',
    'vit c',
    'paracetamol',
    'panadol',
    'ibuprofen',
    'chemiron',
    'multivitamin',
    'folic acid',
    'vitamin d',
    'saline nasal spray',
    'antacid',
    'gaviscon',
    'aspirin',
    'actifed',
    'procold',
    'coartem',
    'lonart',
    'amatem',
    'vitamin b complex',
    'zinc'
  ],
  patterns: [
    /\bvit(amin)?\s+c\b/i,
    /\bparacetamol\b/i,
    /\bpanadol\b/i,
    /\bibuprofen\b/i,
    /\bchemiron\b/i,
    /\bmultivitamin\b/i,
    /\bfolic\s+acid\b/i,
    /\bcoartem\b/i,
    /\blonart\b/i,
    /\bamatem\b/i
  ]
};
