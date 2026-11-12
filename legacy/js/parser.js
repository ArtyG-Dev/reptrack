/* Natural-language → structured sets.
 *
 * Pure functions only: no DOM, no storage, no speech API. Everything here is
 * exercised directly by tests/parser.test.js.
 *
 * Supported (see BUILD_SPEC §4) — reps-mode (strength, cardio, calisthenics):
 *   "bench press 60 kilos for 10"        → 1 set,  60 kg × 10
 *   "squat 100 kilos 5 reps 3 sets"      → 3 sets, 100 kg × 5
 *   "deadlift 140 for 5"                 → unit falls back to the user setting
 *   "add another set"                    → repeat the last logged set
 *   "make that 8" / "change that to 8"   → amend the reps of the last logged set
 *   "warm-up bench 40 for 10"            → any of the above, marked as warm-up sets
 *   "same as last time"                  → pull the previous session's entry
 *   "60 kilos 10, 65 for 8, 70 for 6"    → three sets against the current exercise
 *
 * Supported — hold-mode (yoga, pilates, a timed calisthenics hold): which grammar
 * applies is decided by the matched exercise's `mode`, not by anything in the
 * phrase itself.
 *   "plank for 60 seconds"                    → 1 hold, 60s
 *   "downward dog 30 seconds each side"       → 2 holds, 30s each, side left/right
 *   "child's pose for a minute"               → 1 hold, 60s
 *   "plank 30 seconds 3 rounds"               → 3 holds, 30s each
 */

const NUMBER_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90
};
const MULTIPLIER_WORDS = { hundred: 100, thousand: 1000 };

const KG_WORDS = new Set(['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramme', 'kilogrammes']);
const LB_WORDS = new Set(['lb', 'lbs', 'pound', 'pounds']);

const REPS_WORDS = new Set(['rep', 'reps', 'repetition', 'repetitions']);
const SETS_WORDS = new Set(['set', 'sets']);
const REPS_LEAD = new Set(['for', 'x', 'times', 'by', 'of']);
const WEIGHT_LEAD = new Set(['at', 'with', 'on']);

const SECOND_WORDS = new Set(['second', 'seconds', 'sec', 'secs']);
const MINUTE_WORDS = new Set(['minute', 'minutes', 'min', 'mins']);
const ROUND_WORDS = new Set(['round', 'rounds']);

const LEADING_FILLER = ['ok', 'okay', 'hey', 'please', 'log', 'record', 'add', 'i', 'did', 'do', 'the', 'a', 'an', 'my', 'lets', 'let'];
const TRAILING_FILLER = ['for', 'at', 'with', 'of', 'did', 'do', 'the', 'a', 'an', 'i', 'was', 'is'];

export const MATCH_THRESHOLD = 0.72;

/* ---------- text normalisation ---------- */

export function normalizeTranscript(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[-–—]/g, ' ')
    .replace(/[^a-z0-9., ]/g, ' ')
    .replace(/\s*\.\s*(?![0-9])/g, ' ')   // sentence dots go; decimal points stay
    .replace(/\s*,\s*/g, ' , ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUnitWords(text) {
  return text.split(' ').map((tok) => {
    if (KG_WORDS.has(tok)) return 'kg';
    if (LB_WORDS.has(tok)) return 'lb';
    return tok;
  }).join(' ');
}

/** Converts spoken numbers ("sixty two point five", "one hundred and five") to digits. */
export function wordsToNumbers(text) {
  const tokens = text.split(' ');
  const out = [];
  let i = 0;

  const isNumWord = (t) => Object.hasOwn(NUMBER_WORDS, t) || Object.hasOwn(MULTIPLIER_WORDS, t);

  while (i < tokens.length) {
    if (!isNumWord(tokens[i])) { out.push(tokens[i]); i += 1; continue; }

    let total = 0;
    let current = 0;
    let consumed = 0;

    while (i < tokens.length) {
      const tok = tokens[i];
      if (Object.hasOwn(NUMBER_WORDS, tok)) {
        current += NUMBER_WORDS[tok];
        i += 1; consumed += 1;
      } else if (Object.hasOwn(MULTIPLIER_WORDS, tok)) {
        const mult = MULTIPLIER_WORDS[tok];
        current = (current || 1) * mult;
        if (mult >= 1000) { total += current; current = 0; }
        i += 1; consumed += 1;
      } else if (tok === 'and' && isNumWord(tokens[i + 1] ?? '')) {
        i += 1; consumed += 1;                       // "one hundred and five"
      } else {
        break;
      }
    }

    let value = total + current;

    // "point five" → .5
    if (tokens[i] === 'point' && Object.hasOwn(NUMBER_WORDS, tokens[i + 1] ?? '')) {
      let decimals = '';
      i += 1;
      while (Object.hasOwn(NUMBER_WORDS, tokens[i] ?? '')) {
        decimals += String(NUMBER_WORDS[tokens[i]]);
        i += 1;
      }
      value = Number(`${value}.${decimals}`);
    } else if (tokens[i] === 'and' && tokens[i + 1] === 'a' && tokens[i + 2] === 'half') {
      value += 0.5;
      i += 3;
    } else if (tokens[i] === 'a' && tokens[i + 1] === 'half') {
      value += 0.5;
      i += 2;
    }

    if (consumed === 0) { out.push(tokens[i]); i += 1; continue; }
    out.push(String(value));
  }

  return out.join(' ');
}

/** "a minute" / "a second" — the indefinite article standing in for "one". */
function repairIndefiniteDuration(text) {
  return text.replace(/\ba (minute|second|round)\b/g, '1 $1');
}

/** Recognisers sometimes hear "for" as "four" between a weight and a rep count. */
function repairForFourWords(text) {
  return text.replace(/\b(kg|lb) four\b/g, '$1 for');
}

function repairForFourDigits(text) {
  return text.replace(/(\d+(?:\.\d+)?\s+(?:kg|lb))\s+4\s+(?=\d)/g, '$1 for ');
}

export function prepare(text) {
  return repairForFourDigits(repairIndefiniteDuration(wordsToNumbers(repairForFourWords(normalizeUnitWords(normalizeTranscript(text))))));
}

/* ---------- fuzzy exercise matching ---------- */

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 0 : 1 - levenshtein(a, b) / max;
}

function canon(s) {
  return normalizeTranscript(s).split(' ').map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)).join(' ');
}

/**
 * Best match for a spoken exercise name.
 * @returns {{exercise: object|null, score: number}}
 */
export function matchExercise(spoken, exercises = []) {
  const needle = canon(spoken);
  if (!needle) return { exercise: null, score: 0 };

  let best = { exercise: null, score: 0 };
  for (const ex of exercises) {
    const candidates = [ex.name, ...(ex.aliases || [])];
    for (const candidate of candidates) {
      const hay = canon(candidate);
      if (!hay) continue;
      let score = similarity(needle, hay);
      if (hay === needle) score = 1;
      else if (needle.startsWith(`${hay} `) || hay.startsWith(`${needle} `)) score = Math.max(score, 0.92);
      else if (hay.split(' ').every((w) => needle.split(' ').includes(w))) score = Math.max(score, 0.86);
      if (score > best.score) best = { exercise: ex, score };
    }
  }
  return best;
}

/* ---------- segment parsing: reps mode ---------- */

const NUM_RE = /^\d+(?:\.\d+)?$/;

function parseSegment(tokens, { defaultUnit, isBodyweight }) {
  const nums = [];
  let unit = null;
  let rpe = null;

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (!NUM_RE.test(tok)) continue;

    const value = Number(tok);
    const prev = tokens[i - 1];
    const prev2 = tokens[i - 2];
    const next = tokens[i + 1];

    if (prev === 'rpe' || prev2 === 'rpe') { rpe = value; continue; }

    let tag = null;
    if (next === 'kg' || next === 'lb') { tag = 'weight'; unit = next; }
    else if (REPS_WORDS.has(next)) tag = 'reps';
    else if (SETS_WORDS.has(next)) tag = 'sets';
    else if (REPS_LEAD.has(prev)) tag = 'reps';
    else if (WEIGHT_LEAD.has(prev)) tag = 'weight';

    nums.push({ value, tag });
  }

  if (!nums.length) return null;

  const taken = (tag) => nums.find((n) => n.tag === tag);
  const untagged = nums.filter((n) => n.tag === null);

  let weight = taken('weight')?.value ?? null;
  let reps = taken('reps')?.value ?? null;
  let sets = taken('sets')?.value ?? null;

  // Fill the empty slots in the order people speak them: weight, then reps,
  // then a set count. Bodyweight work leads with reps instead.
  for (const n of untagged) {
    if (isBodyweight) {
      if (reps === null) { reps = n.value; continue; }
      if (weight === null) { weight = n.value; continue; }
    } else {
      if (weight === null) { weight = n.value; continue; }
      if (reps === null) { reps = n.value; continue; }
    }
    if (sets === null) sets = n.value;
  }

  // A single bare number reads as reps for bodyweight work, otherwise as weight.
  if (weight !== null && reps === null && isBodyweight) { reps = weight; weight = 0; }

  return {
    weight: weight === null ? (isBodyweight ? 0 : null) : weight,
    reps,
    sets: sets === null ? 1 : sets,
    unit: unit || defaultUnit,
    rpe
  };
}

/* ---------- segment parsing: hold mode ---------- */

/**
 * @returns {{holdSeconds: number, rounds: number, each: boolean}|null}
 */
function parseHoldSegment(tokens) {
  let holdSeconds = null;
  let rounds = null;
  let each = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if ((tok === 'each' || tok === 'per') && tokens[i + 1] === 'side') each = true;
    if (tok === 'both' && tokens[i + 1] === 'sides') each = true;
    if (!NUM_RE.test(tok)) continue;

    const value = Number(tok);
    const next = tokens[i + 1];

    if (SECOND_WORDS.has(next)) holdSeconds = (holdSeconds || 0) + value;
    else if (MINUTE_WORDS.has(next)) holdSeconds = (holdSeconds || 0) + value * 60;
    else if (ROUND_WORDS.has(next) || SETS_WORDS.has(next)) rounds = value;
    else if (holdSeconds === null) holdSeconds = value;   // a bare number defaults to seconds
  }

  if (holdSeconds === null || holdSeconds <= 0) return null;
  return { holdSeconds, rounds: rounds && rounds > 0 ? Math.round(rounds) : 1, each };
}

function splitSegments(tokens) {
  const segments = [[]];
  for (const tok of tokens) {
    if (tok === ',' || tok === 'then' || tok === 'and') {
      if (segments.at(-1).length) segments.push([]);
      continue;
    }
    segments.at(-1).push(tok);
  }
  return segments.filter((s) => s.length);
}

/* ---------- top-level parse ---------- */

/** Carries holdSeconds/side through only when the source set actually has them. */
function carrySet(source) {
  const base = { weight: source.weight, unit: source.unit, reps: source.reps, rpe: source.rpe ?? null };
  return source.holdSeconds != null ? { ...base, holdSeconds: source.holdSeconds, side: source.side ?? null } : base;
}

/**
 * @param {string} transcript raw text from speech recognition or the text fallback
 * @param {object} ctx
 * @param {Array}  ctx.exercises        exercise dictionary
 * @param {string} ctx.defaultUnit      'kg' | 'lb'
 * @param {object} [ctx.currentExercise] exercise in focus when none is spoken
 * @param {object} [ctx.lastSet]        last set logged this session (for "add another set")
 * @param {Function} [ctx.lastSetsFor]  (exerciseId) => set[] from the previous session
 */
export function parseTranscript(transcript, ctx = {}) {
  const {
    exercises = [],
    defaultUnit = 'kg',
    currentExercise = null,
    lastSet = null,
    lastSetsFor = null
  } = ctx;

  const raw = String(transcript ?? '');
  const normalized = prepare(raw);
  const base = {
    ok: false,
    intent: 'unknown',
    transcript: raw,
    normalized,
    exercise: null,
    exerciseConfidence: 0,
    sets: [],
    warnings: [],
    error: null
  };

  if (!normalized) return { ...base, error: 'Nothing was heard.' };

  /* --- "warm-up" anywhere in the phrase: parse the rest, mark the sets --- */
  const WARMUP = /\bwarm\s*-?\s*ups?\b(?:\s+sets?)?/i;
  if (WARMUP.test(normalized) || WARMUP.test(raw)) {
    const rest = parseTranscript(raw.replace(WARMUP, ' ').replace(/\s+/g, ' ').trim(), ctx);
    return { ...rest, transcript: raw, sets: rest.sets.map((x) => ({ ...x, isWarmup: true })) };
  }

  const tokens = normalized.split(' ');

  /* --- intent: amend the last set ("make that 8", "change that to 8") ---
   * Edits the reps of the most recently logged set — or its seconds, for a
   * hold, which has no reps. Like everything else it goes back through the
   * confirm sheet; this only proposes the change. */
  const amend = normalized.match(/^(?:make|change|set)\s+(?:that|it)(?:\s+to)?(?:\s+(\d+))?(?:\s+(?:reps?|seconds?|secs?))?$/);
  if (amend) {
    if (!lastSet) return { ...base, intent: 'amend-last', error: 'No set logged yet to change.' };
    const value = Number(amend[1]);
    if (!amend[1] || !(value > 0)) return { ...base, intent: 'amend-last', error: 'Change it to what? Say a number, like “make that 8”.' };
    const changed = carrySet(lastSet);
    if (changed.holdSeconds != null) changed.holdSeconds = value;
    else changed.reps = value;
    return {
      ...base,
      ok: true,
      intent: 'amend-last',
      targetSetId: lastSet.id ?? null,
      exercise: lastSet.exercise ?? currentExercise,
      exerciseConfidence: 1,
      sets: [changed]
    };
  }

  /* --- intent: repeat the last set --- */
  if (/\b(add|log|do|one)\s+(another|more|again)\b/.test(normalized) || /\banother (one|set|rep|hold)\b/.test(normalized) || /\bsame again\b/.test(normalized)) {
    if (!lastSet) {
      return { ...base, intent: 'repeat-last', error: 'No set logged yet to repeat.' };
    }
    return {
      ...base,
      ok: true,
      intent: 'repeat-last',
      exercise: lastSet.exercise ?? currentExercise,
      exerciseConfidence: 1,
      sets: [carrySet(lastSet)]
    };
  }

  /* --- intent: same as last time --- */
  if (/\bsame as (last|previous)( time| session| week)?\b/.test(normalized) || /\blike last time\b/.test(normalized)) {
    const spokenName = normalized
      .replace(/\bsame as (last|previous)( time| session| week)?\b/, ' ')
      .replace(/\blike last time\b/, ' ')
      .trim();
    const match = spokenName ? matchExercise(spokenName, exercises) : { exercise: null, score: 0 };
    const exercise = match.score >= MATCH_THRESHOLD ? match.exercise : currentExercise;

    if (!exercise) return { ...base, intent: 'same-as-last', error: 'Which exercise? Pick one first, or say its name.' };
    const previous = typeof lastSetsFor === 'function' ? (lastSetsFor(exercise.id) || []) : [];
    if (!previous.length) {
      return { ...base, intent: 'same-as-last', exercise, exerciseConfidence: match.score || 1, error: `No previous sets recorded for ${exercise.name}.` };
    }
    return {
      ...base,
      ok: true,
      intent: 'same-as-last',
      exercise,
      exerciseConfidence: match.score || 1,
      sets: previous.map(carrySet)
    };
  }

  /* --- intent: log one or more sets/holds --- */
  const firstNumIdx = tokens.findIndex((t) => NUM_RE.test(t));
  let head = firstNumIdx === -1 ? tokens.slice() : tokens.slice(0, firstNumIdx);

  while (head.length && LEADING_FILLER.includes(head[0])) head.shift();
  while (head.length && TRAILING_FILLER.includes(head.at(-1))) head.pop();
  head = head.filter((t) => t !== ',');

  const spokenName = head.join(' ').trim();
  let exercise = currentExercise;
  let confidence = currentExercise ? 0.5 : 0;
  const warnings = [];

  if (spokenName) {
    const match = matchExercise(spokenName, exercises);
    if (match.score >= MATCH_THRESHOLD) {
      exercise = match.exercise;
      confidence = match.score;
      if (match.score < 0.9) warnings.push(`Heard "${spokenName}" — matched to ${match.exercise.name}. Check before saving.`);
    } else if (match.exercise) {
      return {
        ...base,
        intent: 'log',
        exercise: null,
        exerciseConfidence: match.score,
        error: `No exercise matches "${spokenName}". Closest is ${match.exercise.name} — add it in Exercises, or pick one and try again.`
      };
    } else {
      return { ...base, intent: 'log', error: `No exercise matches "${spokenName}".` };
    }
  }

  if (!exercise) {
    return { ...base, intent: 'log', error: 'No exercise named, and none is selected.' };
  }

  const body = firstNumIdx === -1 ? [] : tokens.slice(firstNumIdx);
  const segments = splitSegments(body);
  const parsedSets = [];

  if (exercise.mode === 'hold') {
    for (const segment of segments) {
      const parsed = parseHoldSegment(segment);
      if (!parsed) {
        warnings.push(`Skipped "${segment.join(' ')}" — no hold duration in it.`);
        continue;
      }
      const sides = parsed.each ? ['left', 'right'] : [null];
      const count = Math.min(Math.max(parsed.rounds, 1), 20);
      for (let i = 0; i < count; i += 1) {
        for (const side of sides) {
          parsedSets.push({ holdSeconds: parsed.holdSeconds, side, rpe: null });
        }
      }
    }
    if (!parsedSets.length) {
      return { ...base, intent: 'log', exercise, exerciseConfidence: confidence, warnings, error: 'Heard the exercise but no hold duration.' };
    }
  } else {
    for (const segment of segments) {
      const parsed = parseSegment(segment, { defaultUnit, isBodyweight: Boolean(exercise.isBodyweight) });
      if (!parsed) continue;
      if (parsed.reps === null || parsed.reps <= 0) {
        warnings.push(`Skipped "${segment.join(' ')}" — no rep count in it.`);
        continue;
      }
      if (parsed.weight === null) {
        warnings.push(`Skipped "${segment.join(' ')}" — no weight in it.`);
        continue;
      }
      const count = Math.min(Math.max(Math.round(parsed.sets) || 1, 1), 20);
      for (let i = 0; i < count; i += 1) {
        parsedSets.push({ weight: parsed.weight, unit: parsed.unit, reps: Math.round(parsed.reps), rpe: parsed.rpe });
      }
    }
    if (!parsedSets.length) {
      return { ...base, intent: 'log', exercise, exerciseConfidence: confidence, warnings, error: 'Heard the exercise but no weight and reps.' };
    }
  }

  return { ...base, ok: true, intent: 'log', exercise, exerciseConfidence: confidence, sets: parsedSets, warnings };
}

/** Human-readable one-liner for a parsed set, used in the confirm sheet and lists. */
export function describeSet(entry) {
  if (entry.holdSeconds != null) {
    const text = `${formatNumber(entry.holdSeconds)}s hold`;
    return entry.side ? `${text} (${entry.side})` : text;
  }
  const w = Number(entry.weight) === 0 ? 'bodyweight' : `${formatNumber(entry.weight)} ${entry.unit}`;
  const rpe = entry.rpe != null && entry.rpe !== '' ? ` @ RPE ${formatNumber(entry.rpe)}` : '';
  return `${w} × ${entry.reps}${rpe}`;
}

export function formatNumber(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '0';
  return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100);
}
