/* Starter exercise dictionary. Deliberately small — a big database is the thing
 * that makes other trackers slow to search. Users add their own in Exercises.
 * Aliases exist so the voice parser can match what people actually say.
 *
 * Every exercise has a `category` (strength | cardio | calisthenics | yoga |
 * pilates | ...) and a `mode` ('reps' — weight/reps/sets, the default, or
 * 'hold' — a timed duration). CATEGORIES below is a suggestion list for the
 * Exercises editor's autocomplete, not a hard enum — a user can type any
 * category they like and it just works.
 */

export const CATEGORIES = ['strength', 'cardio', 'calisthenics', 'yoga', 'pilates'];

/** The muscle groups behind every muscle view: the figure, the selector, the
 *  ranked list and the weekly charts. The canonical seventeen from the
 *  3D-muscle-map brief plus Adductors, kept at the user's request so inner-thigh
 *  work still shows. Ids are stable storage keys; MUSCLE_LABELS is what people see. */
export const MUSCLES = [
  'chest', 'front-delts', 'side-delts', 'rear-delts', 'upper-back-lats', 'traps',
  'biceps', 'triceps', 'forearms', 'abs', 'obliques', 'lower-back', 'glutes',
  'hip-flexors', 'quads', 'hamstrings', 'calves', 'adductors'
];

export const MUSCLE_LABELS = Object.freeze({
  chest: 'Chest',
  'front-delts': 'Front shoulders',
  'side-delts': 'Side shoulders',
  'rear-delts': 'Rear shoulders',
  'upper-back-lats': 'Upper back / lats',
  traps: 'Traps',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  'lower-back': 'Lower back',
  glutes: 'Glutes',
  'hip-flexors': 'Hip flexors',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  calves: 'Calves',
  adductors: 'Adductors'
});

/** For an exercise that isn't a starter: a rough guess from its old single
 *  `muscleGroup`, used once by the backfill. Primary only — a guess shouldn't
 *  claim secondaries. */
export const MUSCLE_GROUP_MUSCLES = {
  chest: ['chest'],
  back: ['upper-back-lats'],
  shoulders: ['front-delts', 'side-delts'],
  arms: ['biceps', 'triceps'],
  legs: ['quads', 'hamstrings', 'glutes'],
  core: ['abs', 'obliques'],
  other: []
};

export const SEED_EXERCISES = [
  // Strength
  { name: 'Bench Press',        aliases: ['bench', 'flat bench', 'barbell bench press', 'bench press'], muscleGroup: 'chest', category: 'strength', primaryMuscles: ['chest'], secondaryMuscles: ['front-delts', 'triceps'] },
  { name: 'Incline Bench Press', aliases: ['incline bench', 'incline press'], muscleGroup: 'chest', category: 'strength', primaryMuscles: ['chest', 'front-delts'], secondaryMuscles: ['triceps'] },
  { name: 'Overhead Press',     aliases: ['ohp', 'shoulder press', 'military press', 'press'], muscleGroup: 'shoulders', category: 'strength', primaryMuscles: ['front-delts'], secondaryMuscles: ['side-delts', 'triceps', 'traps'] },
  { name: 'Back Squat',         aliases: ['squat', 'squats', 'barbell squat', 'back squats'], muscleGroup: 'legs', category: 'strength', primaryMuscles: ['quads', 'glutes'], secondaryMuscles: ['adductors', 'hamstrings', 'lower-back'] },
  { name: 'Front Squat',        aliases: ['front squats'], muscleGroup: 'legs', category: 'strength', primaryMuscles: ['quads'], secondaryMuscles: ['glutes', 'abs', 'adductors'] },
  { name: 'Deadlift',           aliases: ['deadlifts', 'conventional deadlift', 'dead lift'], muscleGroup: 'back', category: 'strength', primaryMuscles: ['glutes', 'hamstrings', 'lower-back'], secondaryMuscles: ['upper-back-lats', 'traps', 'forearms', 'quads'] },
  { name: 'Romanian Deadlift',  aliases: ['rdl', 'rdls', 'romanian deadlifts', 'stiff leg deadlift'], muscleGroup: 'back', category: 'strength', primaryMuscles: ['hamstrings', 'glutes'], secondaryMuscles: ['lower-back', 'forearms'] },
  { name: 'Barbell Row',        aliases: ['row', 'rows', 'bent over row', 'pendlay row'], muscleGroup: 'back', category: 'strength', primaryMuscles: ['upper-back-lats'], secondaryMuscles: ['rear-delts', 'biceps', 'lower-back', 'traps'] },
  { name: 'Lat Pulldown',       aliases: ['pulldown', 'pulldowns', 'lat pull down'], muscleGroup: 'back', category: 'strength', primaryMuscles: ['upper-back-lats'], secondaryMuscles: ['biceps', 'rear-delts'] },
  { name: 'Leg Press',          aliases: ['leg presses'], muscleGroup: 'legs', category: 'strength', primaryMuscles: ['quads'], secondaryMuscles: ['glutes', 'adductors'] },
  { name: 'Leg Curl',           aliases: ['hamstring curl', 'leg curls'], muscleGroup: 'legs', category: 'strength', primaryMuscles: ['hamstrings'], secondaryMuscles: ['calves'] },
  { name: 'Leg Extension',      aliases: ['leg extensions', 'quad extension'], muscleGroup: 'legs', category: 'strength', primaryMuscles: ['quads'], secondaryMuscles: [] },
  { name: 'Dumbbell Curl',      aliases: ['bicep curl', 'biceps curl', 'curl', 'curls', 'dumbbell curls'], muscleGroup: 'arms', category: 'strength', primaryMuscles: ['biceps'], secondaryMuscles: ['forearms'] },
  { name: 'Tricep Pushdown',    aliases: ['pushdown', 'tricep push down', 'rope pushdown'], muscleGroup: 'arms', category: 'strength', primaryMuscles: ['triceps'], secondaryMuscles: [] },
  { name: 'Lateral Raise',      aliases: ['lat raise', 'side raise', 'lateral raises'], muscleGroup: 'shoulders', category: 'strength', primaryMuscles: ['side-delts'], secondaryMuscles: [] },
  { name: 'Face Pull',          aliases: ['face pulls'], muscleGroup: 'shoulders', category: 'strength', primaryMuscles: ['rear-delts'], secondaryMuscles: ['traps'] },
  { name: 'Hip Thrust',         aliases: ['hip thrusts', 'glute bridge'], muscleGroup: 'legs', category: 'strength', primaryMuscles: ['glutes'], secondaryMuscles: ['hamstrings'] },
  { name: 'Calf Raise',         aliases: ['calf raises', 'standing calf raise'], muscleGroup: 'legs', category: 'strength', primaryMuscles: ['calves'], secondaryMuscles: [] },

  // Calisthenics — bodyweight reps/sets, with an added-weight option via weight field
  { name: 'Pull Up',            aliases: ['pull ups', 'pullup', 'pullups', 'chin up', 'chin ups'], muscleGroup: 'back', category: 'calisthenics', isBodyweight: true, primaryMuscles: ['upper-back-lats'], secondaryMuscles: ['biceps', 'rear-delts', 'forearms'] },
  { name: 'Push Up',            aliases: ['push ups', 'pushup', 'pushups', 'press up', 'press ups'], muscleGroup: 'chest', category: 'calisthenics', isBodyweight: true, primaryMuscles: ['chest'], secondaryMuscles: ['front-delts', 'triceps', 'abs'] },
  { name: 'Dip',                aliases: ['dips', 'parallel bar dips'], muscleGroup: 'chest', category: 'calisthenics', isBodyweight: true, primaryMuscles: ['triceps', 'chest'], secondaryMuscles: ['front-delts'] },
  { name: 'Pistol Squat',       aliases: ['pistol squats', 'single leg squat'], muscleGroup: 'legs', category: 'calisthenics', isBodyweight: true, primaryMuscles: ['quads', 'glutes'], secondaryMuscles: ['adductors', 'calves'] },
  { name: 'Plank',              aliases: ['planks'], muscleGroup: 'core', category: 'calisthenics', mode: 'hold', primaryMuscles: ['abs'], secondaryMuscles: ['obliques'] },

  // Yoga — timed poses
  { name: 'Downward Dog',       aliases: ['downward facing dog', 'down dog'], muscleGroup: 'other', category: 'yoga', mode: 'hold', primaryMuscles: [], secondaryMuscles: ['hamstrings', 'calves', 'front-delts'] },
  { name: 'Warrior II',         aliases: ['warrior 2', 'warrior two'], muscleGroup: 'other', category: 'yoga', mode: 'hold', primaryMuscles: ['quads'], secondaryMuscles: ['glutes', 'adductors'] },
  { name: "Child's Pose",       aliases: ['childs pose', 'child pose'], muscleGroup: 'other', category: 'yoga', mode: 'hold', primaryMuscles: [], secondaryMuscles: ['lower-back'] },

  // Pilates — a mix of timed holds and counted reps
  { name: 'The Hundred',        aliases: ['hundred', 'the 100'], muscleGroup: 'core', category: 'pilates', mode: 'hold', primaryMuscles: ['abs'], secondaryMuscles: ['hip-flexors'] },
  { name: 'Roll Up',            aliases: ['roll-up', 'rollup', 'roll ups'], muscleGroup: 'core', category: 'pilates', isBodyweight: true, primaryMuscles: ['abs'], secondaryMuscles: ['hip-flexors'] },
  { name: 'Plank Series',       aliases: ['pilates plank'], muscleGroup: 'core', category: 'pilates', mode: 'hold', primaryMuscles: ['abs'], secondaryMuscles: ['obliques'] }
];
