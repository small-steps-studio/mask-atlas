'use strict';
// Word parts for the invented names, streets, towns and organisations. The parts are original and
// are combined (part + part + part) so that the space is large and no result is a real person.
// Every list is plain data; the choice of parts comes from the keyed functions (see run.js).

const GIVEN_ONSET = ['Al', 'Ber', 'Cal', 'Dar', 'El', 'Fen', 'Gar', 'Hel', 'Ian', 'Jul', 'Kes', 'Lor', 'Mar', 'Nel', 'Ora', 'Pen', 'Quen', 'Ran', 'Sel', 'Tev',
  'Ulf', 'Ver', 'Wen', 'Xan', 'Yan', 'Zel', 'Ada', 'Bri', 'Cle', 'Dor', 'Eri', 'Fio', 'Gwy', 'Han', 'Ime', 'Jas', 'Kar', 'Lia', 'Mir', 'Nor', 'Ole', 'Pia',
  'Rho', 'Sab', 'Tor', 'Una', 'Vic', 'Wil', 'Yve', 'Zia', 'Ald', 'Bar', 'Cor', 'Dev', 'Esm', 'Fran', 'Gil', 'Hug', 'Ing', 'Joa'];
const GIVEN_MIDDLE = ['', '', 'a', 'e', 'i', 'o', 'an', 'el', 'en', 'er', 'in', 'on', 'or', 'ar', 'al', 'il', 'is', 'et', 'ol', 'um'];
const GIVEN_END = ['a', 'e', 'o', 'ia', 'ie', 'ine', 'ette', 'ard', 'ric', 'ton', 'wen', 'las', 'mir', 'na', 'ra', 'sa', 'lyn', 'bert', 'wyn', 'don', 'mund',
  'ley', 'ana', 'ena', 'ina', 'ora', 'eth', 'ith', 'ald', 'ius', 'ander', 'elle', 'ika', 'ira', 'ola', 'uel'];

const FAMILY_ROOT = ['Ash', 'Birch', 'Cald', 'Dun', 'Elm', 'Fair', 'Gran', 'Harr', 'Ive', 'Kemp', 'Lang', 'Mill', 'Nor', 'Oak', 'Pen', 'Quar', 'Rush', 'Stan',
  'Thorn', 'Under', 'Vale', 'Wex', 'Yar', 'Brook', 'Cross', 'Dale', 'East', 'Fox', 'Hawk', 'Iron', 'Kirk', 'Lark', 'Marsh', 'North', 'Old', 'Pine', 'Raven',
  'Stone', 'Tall', 'West', 'Wild', 'Ames', 'Bram', 'Carr', 'Dray', 'Ever', 'Fenn', 'Gale', 'Holl', 'Jasp', 'Kell', 'Lyn', 'Marl', 'Nash', 'Orm', 'Pell',
  'Rye', 'Sark', 'Tarn', 'Wick', 'Alder', 'Bex', 'Cam', 'Dorn', 'Esk', 'Flint', 'Garr', 'Heath', 'Ing', 'Jarr', 'Kest', 'Lind', 'Moss', 'Nev', 'Ost',
  'Pryor', 'Quil', 'Rand', 'Sand', 'Tru', 'Ulm', 'Vane', 'Wren', 'Yew', 'Zeal', 'Abbot', 'Bright', 'Coll', 'Dray', 'Eld', 'Frost', 'Glen', 'Hart', 'Isle',
  'Jenn', 'Knoll', 'Lowe', 'Mead', 'Nye', 'Ormer', 'Park', 'Reed', 'Slade', 'Tyne'];
const FAMILY_MIDDLE = ['', '', 'er', 'en', 'al', 'or', 'in'];
const FAMILY_END = ['wick', 'ford', 'ham', 'ley', 'ton', 'worth', 'field', 'by', 'stead', 'mere', 'crest', 'hurst', 'wood', 'dale', 'gate', 'brook', 'well',
  'shaw', 'combe', 'berry', 'holm', 'thwaite', 'den', 'low', 'land', 'more', 'ridge', 'wall', 'bridge', 'burn', 'cliff', 'croft', 'fell', 'grove', 'hill',
  'ing', 'ly', 'mont', 'ness', 'wyn'];

const TOWN_END = ['ford', 'bridge', 'port', 'mouth', 'vale', 'ton', 'burg', 'field', 'haven', 'ridge', 'worth', 'stead', 'cliff', 'wick', 'mere', 'ham'];
const TOWN_EXTRA = ['Heights', 'Falls', 'Springs', 'Park', 'Hollow', 'Landing', 'Junction', 'Crossing', 'Point', 'Grove'];

const STREET_TYPES = ['Street', 'Road', 'Avenue', 'Drive', 'Terrace', 'Court', 'Lane', 'Way', 'Place', 'Row', 'Landing', 'Mews', 'Gate', 'Alley', 'Chase',
  'Square', 'Plaza', 'Boulevard', 'Circle', 'Walk', 'Close', 'Crescent', 'Parkway', 'Trail', 'Hill', 'Park'];
const STREET_ABBREVIATIONS = { st: 'Street', rd: 'Road', ave: 'Avenue', av: 'Avenue', dr: 'Drive', ter: 'Terrace', ct: 'Court', ln: 'Lane', pl: 'Place', blvd: 'Boulevard', cir: 'Circle', pkwy: 'Parkway', trl: 'Trail', hwy: 'Highway' };

const ORG_TYPES = ['Hospital', 'Clinic', 'Laboratories', 'Laboratory', 'Pharmacy', 'Health', 'Medical', 'Center', 'Centre', 'Care', 'Group', 'Insurance', 'Mutual',
  'Plan', 'Imaging', 'Services', 'Associates', 'Practice', 'Institute', 'Partners', 'Systems', 'Network', 'Surgery', 'Dental', 'Therapy', 'Radiology'];
const ORG_DEFAULT_TYPE = 'Health Services';

const TITLE_WORDS = ['Mr', 'Mrs', 'Ms', 'Miss', 'Mx', 'Dr', 'Prof', 'Sir', 'Dame', 'Rev', 'Fr', 'Sr', 'Jr', 'Mister', 'Doctor', 'Nurse'];
const SUFFIX_WORDS = ['jr', 'sr', 'ii', 'iii', 'iv', 'md', 'phd', 'do', 'rn', 'np', 'pa', 'dds', 'dvm', 'esq'];

// Words that are also given names or surnames but are common in clinical text: when one of them is
// a name from the same message, only an exact match of its spelling in the text is replaced.
const COMMON_WORD_NAMES = ['mark', 'rose', 'will', 'grace', 'hope', 'may', 'june', 'april', 'bill', 'art', 'pat', 'rob', 'sue', 'faith', 'joy', 'dawn', 'ruby', 'pearl',
  'amber', 'iris', 'lily', 'violet', 'daisy', 'holly', 'summer', 'winter', 'autumn', 'rich', 'dick', 'frank', 'chase', 'case', 'page', 'bishop', 'baker', 'cook',
  'miller', 'carter', 'cooper', 'fisher', 'hunter', 'porter', 'mason', 'turner', 'ward', 'young', 'long', 'short', 'little', 'white', 'black', 'brown', 'green',
  'gray', 'grey', 'hall', 'lane', 'wood', 'woods', 'field', 'fields', 'hill', 'stone', 'moore', 'price', 'bell', 'bond', 'king', 'prince', 'earl', 'rice', 'reed',
  'wolf', 'fox', 'lamb', 'day', 'bird', 'cross', 'gold', 'silver', 'north', 'west', 'east', 'south', 'major', 'sharp', 'swift', 'wise', 'best', 'love', 'sweet'];

// Words that follow a relation word in clinical text without being a name.
const NOT_A_NAME = ['is', 'was', 'has', 'had', 'at', 'in', 'on', 'to', 'of', 'and', 'or', 'the', 'a', 'an', 'states', 'stated', 'reports', 'reported', 'denies',
  'denied', 'called', 'calls', 'says', 'said', 'came', 'brought', 'wants', 'asked', 'asks', 'requests', 'requested', 'present', 'presents', 'presented', 'with',
  'who', 'will', 'would', 'should', 'agrees', 'agreed', 'declined', 'declines', 'refused', 'refuses', 'complains', 'complained', 'notes', 'noted', 'arrived',
  'visit', 'visits', 'history', 'name', 'contact', 'phone', 'number', 'address', 'email', 'e-mail', 'date', 'born', 'age', 'aged', 'lives', 'live', 'living'];

// Words that open organisation, department and contact names without identifying anyone.
const GENERIC_ORG_WORDS = ['member', 'members', 'claim', 'claims', 'status', 'unit', 'department', 'office', 'desk', 'services', 'service', 'billing', 'support', 'customer',
  'eligibility', 'provider', 'providers', 'patient', 'patients', 'accounts', 'account', 'finance', 'payments', 'payment', 'records', 'record', 'inquiries', 'inquiry',
  'utilization', 'authorization', 'authorizations', 'care', 'health', 'medical', 'clinic', 'hospital', 'general', 'regional', 'community', 'national', 'central', 'family',
  'primary', 'emergency', 'outpatient', 'inpatient', 'pharmacy', 'laboratory', 'laboratories', 'imaging', 'radiology', 'surgery', 'dermatology', 'cardiology', 'oncology',
  'theatre', 'theater', 'ward', 'front', 'reception', 'admissions', 'scheduling', 'registration', 'enrollment', 'enrolment', 'intake', 'helpdesk', 'help', 'team', 'group',
  'management', 'administration', 'insurance', 'mutual', 'plan', 'plans', 'network', 'center', 'centre', 'state', 'county', 'city', 'federal', 'public', 'university', 'college', 'school', 'district', 'registry', 'health', 'department', 'bureau', 'agency', 'authority', 'board', 'trust', 'society', 'foundation'];

module.exports = {
  GENERIC_ORG_WORDS,
  GIVEN_ONSET, GIVEN_MIDDLE, GIVEN_END, FAMILY_ROOT, FAMILY_MIDDLE, FAMILY_END, TOWN_END, TOWN_EXTRA, STREET_TYPES, STREET_ABBREVIATIONS,
  ORG_TYPES, ORG_DEFAULT_TYPE, TITLE_WORDS, SUFFIX_WORDS, COMMON_WORD_NAMES, NOT_A_NAME
};
