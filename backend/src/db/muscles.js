// Muscle taxonomy, weekly volume landmarks, and the exercise → muscle mapping.
//
// exercises.muscle_group stays as-is: it's what the library UI groups and filters by, and
// six coarse buckets are the right granularity for "find me a chest exercise". Volume
// analysis needs something finer — "Legs: 20 sets" can't tell you whether that's 18 quad
// sets and 2 hamstring, which is exactly the question worth asking.

// Weekly hard sets per muscle. MEV = the least that still drives growth, MAV = the
// productive middle, MRV = the most that can be recovered from. These are the commonly
// cited landmarks, not precision instruments — treat them as a band, not a target.
const LANDMARKS = {
  chest:       { label: 'Chest',        mev: 8,  mav: 14, mrv: 22 },
  lats:        { label: 'Lats',         mev: 10, mav: 16, mrv: 25 },
  upper_back:  { label: 'Upper back',   mev: 10, mav: 16, mrv: 25 },
  traps:       { label: 'Traps',        mev: 6,  mav: 12, mrv: 20 },
  front_delts: { label: 'Front delts',  mev: 6,  mav: 12, mrv: 18 },
  side_delts:  { label: 'Side delts',   mev: 8,  mav: 16, mrv: 26 },
  rear_delts:  { label: 'Rear delts',   mev: 8,  mav: 14, mrv: 22 },
  biceps:      { label: 'Biceps',       mev: 8,  mav: 14, mrv: 20 },
  triceps:     { label: 'Triceps',      mev: 8,  mav: 14, mrv: 22 },
  forearms:    { label: 'Forearms',     mev: 4,  mav: 8,  mrv: 16 },
  quads:       { label: 'Quads',        mev: 8,  mav: 14, mrv: 20 },
  hamstrings:  { label: 'Hamstrings',   mev: 6,  mav: 12, mrv: 20 },
  glutes:      { label: 'Glutes',       mev: 4,  mav: 12, mrv: 16 },
  adductors:   { label: 'Adductors',    mev: 4,  mav: 8,  mrv: 12 },
  calves:      { label: 'Calves',       mev: 8,  mav: 14, mrv: 20 },
  abs:         { label: 'Abs',          mev: 6,  mav: 12, mrv: 20 },
  lower_back:  { label: 'Lower back',   mev: 4,  mav: 8,  mrv: 14 },
};

// A set counts fully for what it primarily trains and half for what it assists — the
// standard fractional-set convention. Bench builds triceps, but not the way a pushdown does.
const PRIMARY = 1;
const SECONDARY = 0.5;

// [primary…], [secondary…]. Exact name match, case-insensitive.
const EXERCISES = {
  // ── his program ──────────────────────────────────────────────
  'barbell back squat':       [['quads'], ['glutes', 'adductors', 'lower_back']],
  'front squat':              [['quads'], ['glutes', 'upper_back']],
  'hack squat':               [['quads'], ['glutes']],
  'bulgarian split squat':    [['quads'], ['glutes', 'adductors']],
  'barbell rdl':              [['hamstrings'], ['glutes', 'lower_back']],
  'db rdl':                   [['hamstrings'], ['glutes', 'lower_back']],
  'lying leg curl':           [['hamstrings'], []],
  'standing calf raise':      [['calves'], []],
  'leg press calf press':     [['calves'], []],
  'flat db press':            [['chest'], ['triceps', 'front_delts']],
  'incline db press':         [['chest'], ['triceps', 'front_delts']],
  'machine incline press':    [['chest'], ['triceps', 'front_delts']],
  'machine chest press':      [['chest'], ['triceps', 'front_delts']],
  'barbell incline press':    [['chest'], ['triceps', 'front_delts']],
  'weighted dips':            [['chest', 'triceps'], ['front_delts']],
  'close-grip dip':           [['triceps'], ['chest', 'front_delts']],
  'barbell overhead press':   [['front_delts'], ['triceps', 'side_delts']],
  'seated db shoulder press': [['front_delts'], ['triceps', 'side_delts']],
  'weighted pull-up':         [['lats'], ['biceps', 'upper_back', 'forearms']],
  'assisted pull-up':         [['lats'], ['biceps', 'upper_back', 'forearms']],
  'chest-supported row':      [['upper_back'], ['lats', 'biceps', 'rear_delts']],
  'triceps pressdown':        [['triceps'], []],
  'ez-bar curl':              [['biceps'], ['forearms']],
  'cable curl':               [['biceps'], ['forearms']],
  'db curl':                  [['biceps'], ['forearms']],
  'cable lateral raise':      [['side_delts'], []],
  'machine lateral raise':    [['side_delts'], []],
  'band pull-apart':          [['rear_delts'], ['upper_back']],
  'hanging leg raise':        [['abs'], ['forearms']],
  'lying leg raise':          [['abs'], []],

  // ── added after a dry run against the live library flagged these as guesses ──
  'barbell incline bench':    [['chest'], ['triceps', 'front_delts']],
  'db incline press':         [['chest'], ['triceps', 'front_delts']],
  'smith machine incline':    [['chest'], ['triceps', 'front_delts']],
  // Flyes are chest isolation — the elbow angle barely changes, so no triceps credit.
  'cable flye':               [['chest'], ['front_delts']],
  'db flye':                  [['chest'], ['front_delts']],
  'pec deck':                 [['chest'], ['front_delts']],
  'reverse pec deck':         [['rear_delts'], ['upper_back', 'traps']],
  'machine shoulder press':   [['front_delts'], ['triceps', 'side_delts']],
  // A Y-raise is a lower-trap movement with rear-delt involvement, not a side-delt one.
  'cable y-raise':            [['traps'], ['rear_delts', 'front_delts']],
  'incline db y-raise':       [['traps'], ['rear_delts', 'front_delts']],
  // Overhead extension is triceps; the coarse "Arms" fallback had guessed biceps.
  'overhead cable extension': [['triceps'], []],
  'neutral-grip pull-up':     [['lats'], ['biceps', 'upper_back', 'forearms']],
  'nordic ham curl':          [['hamstrings'], ['glutes']],
  'seated leg curl':          [['hamstrings'], []],
  'seated calf raise':        [['calves'], []],
  'trap-bar rdl':             [['hamstrings'], ['glutes', 'lower_back']],
  'walking lunge':            [['quads'], ['glutes', 'adductors']],

  // ── stock library ────────────────────────────────────────────
  'bench press':          [['chest'], ['triceps', 'front_delts']],
  'incline bench press':  [['chest'], ['triceps', 'front_delts']],
  'decline bench press':  [['chest'], ['triceps', 'front_delts']],
  'push-up':              [['chest'], ['triceps', 'front_delts']],
  'chest fly':            [['chest'], []],
  'pull-up':              [['lats'], ['biceps', 'upper_back', 'forearms']],
  'lat pulldown':         [['lats'], ['biceps', 'upper_back']],
  'barbell row':          [['upper_back'], ['lats', 'biceps', 'rear_delts']],
  'seated cable row':     [['upper_back'], ['lats', 'biceps']],
  'deadlift':             [['hamstrings', 'lower_back'], ['glutes', 'traps', 'upper_back', 'forearms']],
  'overhead press':       [['front_delts'], ['triceps', 'side_delts']],
  'arnold press':         [['front_delts'], ['side_delts', 'triceps']],
  'lateral raise':        [['side_delts'], []],
  'front raise':          [['front_delts'], []],
  'face pull':            [['rear_delts'], ['upper_back', 'traps']],
  'squat':                [['quads'], ['glutes', 'adductors', 'lower_back']],
  'leg press':            [['quads'], ['glutes']],
  'romanian deadlift':    [['hamstrings'], ['glutes', 'lower_back']],
  'leg curl':             [['hamstrings'], []],
  'leg extension':        [['quads'], []],
  'calf raise':           [['calves'], []],
  'lunges':               [['quads'], ['glutes', 'adductors']],
  'banded hip abduction': [['glutes'], []],
  'cable hip abduction':  [['glutes'], []],
  'clamshell':            [['glutes'], []],
  'bicep curl':           [['biceps'], ['forearms']],
  'hammer curl':          [['biceps'], ['forearms']],
  'preacher curl':        [['biceps'], []],
  'tricep pushdown':      [['triceps'], []],
  'skull crusher':        [['triceps'], []],
  'dips':                 [['triceps'], ['chest', 'front_delts']],
  'plank':                [['abs'], []],
  'crunches':             [['abs'], []],
  'cable crunch':         [['abs'], []],
  'russian twist':        [['abs'], []],
  'leg raise':            [['abs'], []],
  'dead bug':             [['abs'], []],
};

// Ordered most-specific first, because "Leg Curl" contains "curl" and "Calf Raise"
// contains "raise". Only reached for names not in EXERCISES — a new exercise added from
// the library UI gets something sensible instead of nothing.
const KEYWORDS = [
  [/calf|calves/,               [['calves'], []]],
  [/leg curl|ham(string)? curl|nordic/, [['hamstrings'], []]],
  [/leg extension/,             [['quads'], []]],
  [/rdl|romanian|good ?morning/,[['hamstrings'], ['glutes', 'lower_back']]],
  [/deadlift/,                  [['hamstrings', 'lower_back'], ['glutes', 'traps']]],
  [/squat|lunge|split squat|step.?up|leg press/, [['quads'], ['glutes', 'adductors']]],
  [/hip thrust|glute bridge/,   [['glutes'], ['hamstrings']]],
  // Before the squat/lunge rule, and before the Legs fallback: an abduction
  // exercise reaching either would be credited to quads, which is the opposite of
  // why it is in the program.
  [/abduction|abductor|clamshell|lateral walk|monster walk/, [['glutes'], []]],
  [/pull-?up|chin-?up|pulldown/,[['lats'], ['biceps', 'upper_back']]],
  [/row/,                       [['upper_back'], ['lats', 'biceps']]],
  [/shrug/,                     [['traps'], []]],
  [/face pull|rear delt|reverse (fly|pec)/, [['rear_delts'], ['upper_back']]],
  [/y-raise|y raise/,           [['traps'], ['rear_delts', 'front_delts']]],
  [/lateral raise|side raise/,  [['side_delts'], []]],
  [/overhead press|shoulder press|military/, [['front_delts'], ['triceps', 'side_delts']]],
  [/front raise/,               [['front_delts'], []]],
  [/dip/,                       [['triceps'], ['chest', 'front_delts']]],
  [/fly|flye|pec deck/,         [['chest'], ['front_delts']]],
  [/pushdown|pressdown|skull|tricep|overhead.*extension|french press/, [['triceps'], []]],
  [/curl/,                      [['biceps'], ['forearms']]],
  [/bench|chest press|push-?up|incline press/, [['chest'], ['triceps', 'front_delts']]],
  [/crunch|sit-?up|plank|leg raise|ab |abs|hollow/, [['abs'], []]],
  [/back extension|hyperextension/, [['lower_back'], ['glutes', 'hamstrings']]],
];

// Last resort: keep the coarse group's most representative muscle so an unmapped exercise
// still lands somewhere defensible rather than vanishing from the totals.
const GROUP_FALLBACK = {
  Chest: 'chest', Back: 'lats', Shoulders: 'side_delts',
  Legs: 'quads', Arms: 'biceps', Core: 'abs',
};

// Returns [{ muscle, contribution }], or [] when nothing matches at all.
function musclesFor(name, muscleGroup) {
  const key = String(name || '').trim().toLowerCase();
  let hit = EXERCISES[key];
  let source = 'exact';

  if (!hit) {
    const kw = KEYWORDS.find(([re]) => re.test(key));
    if (kw) { hit = kw[1]; source = 'keyword'; }
  }
  if (!hit) {
    const fallback = GROUP_FALLBACK[muscleGroup];
    if (!fallback) return { rows: [], source: 'none' };
    hit = [[fallback], []];
    source = 'group';
  }

  const [primary, secondary] = hit;
  return {
    source,
    rows: [
      ...primary.map((m) => ({ muscle: m, contribution: PRIMARY })),
      ...secondary.map((m) => ({ muscle: m, contribution: SECONDARY })),
    ],
  };
}

// Exercises where the load moved is bodyweight plus whatever is added or assisted.
const BODYWEIGHT = [
  /pull-?up/, /chin-?up/, /dip/, /push-?up/, /muscle-?up/, /inverted row/,
];
const isBodyweight = (name) => BODYWEIGHT.some((re) => re.test(String(name || '').toLowerCase()));

module.exports = { LANDMARKS, EXERCISES, musclesFor, isBodyweight, PRIMARY, SECONDARY };
