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

export const SEED_EXERCISES = [
  // Strength
  { name: 'Bench Press',        aliases: ['bench', 'flat bench', 'barbell bench press', 'bench press'], muscleGroup: 'chest', category: 'strength' },
  { name: 'Incline Bench Press', aliases: ['incline bench', 'incline press'], muscleGroup: 'chest', category: 'strength' },
  { name: 'Overhead Press',     aliases: ['ohp', 'shoulder press', 'military press', 'press'], muscleGroup: 'shoulders', category: 'strength' },
  { name: 'Back Squat',         aliases: ['squat', 'squats', 'barbell squat', 'back squats'], muscleGroup: 'legs', category: 'strength' },
  { name: 'Front Squat',        aliases: ['front squats'], muscleGroup: 'legs', category: 'strength' },
  { name: 'Deadlift',           aliases: ['deadlifts', 'conventional deadlift', 'dead lift'], muscleGroup: 'back', category: 'strength' },
  { name: 'Romanian Deadlift',  aliases: ['rdl', 'rdls', 'romanian deadlifts', 'stiff leg deadlift'], muscleGroup: 'back', category: 'strength' },
  { name: 'Barbell Row',        aliases: ['row', 'rows', 'bent over row', 'pendlay row'], muscleGroup: 'back', category: 'strength' },
  { name: 'Lat Pulldown',       aliases: ['pulldown', 'pulldowns', 'lat pull down'], muscleGroup: 'back', category: 'strength' },
  { name: 'Leg Press',          aliases: ['leg presses'], muscleGroup: 'legs', category: 'strength' },
  { name: 'Leg Curl',           aliases: ['hamstring curl', 'leg curls'], muscleGroup: 'legs', category: 'strength' },
  { name: 'Leg Extension',      aliases: ['leg extensions', 'quad extension'], muscleGroup: 'legs', category: 'strength' },
  { name: 'Dumbbell Curl',      aliases: ['bicep curl', 'biceps curl', 'curl', 'curls', 'dumbbell curls'], muscleGroup: 'arms', category: 'strength' },
  { name: 'Tricep Pushdown',    aliases: ['pushdown', 'tricep push down', 'rope pushdown'], muscleGroup: 'arms', category: 'strength' },
  { name: 'Lateral Raise',      aliases: ['lat raise', 'side raise', 'lateral raises'], muscleGroup: 'shoulders', category: 'strength' },
  { name: 'Face Pull',          aliases: ['face pulls'], muscleGroup: 'shoulders', category: 'strength' },
  { name: 'Hip Thrust',         aliases: ['hip thrusts', 'glute bridge'], muscleGroup: 'legs', category: 'strength' },
  { name: 'Calf Raise',         aliases: ['calf raises', 'standing calf raise'], muscleGroup: 'legs', category: 'strength' },

  // Calisthenics — bodyweight reps/sets, with an added-weight option via weight field
  { name: 'Pull Up',            aliases: ['pull ups', 'pullup', 'pullups', 'chin up', 'chin ups'], muscleGroup: 'back', category: 'calisthenics', isBodyweight: true },
  { name: 'Push Up',            aliases: ['push ups', 'pushup', 'pushups', 'press up', 'press ups'], muscleGroup: 'chest', category: 'calisthenics', isBodyweight: true },
  { name: 'Dip',                aliases: ['dips', 'parallel bar dips'], muscleGroup: 'chest', category: 'calisthenics', isBodyweight: true },
  { name: 'Pistol Squat',       aliases: ['pistol squats', 'single leg squat'], muscleGroup: 'legs', category: 'calisthenics', isBodyweight: true },
  { name: 'Plank',              aliases: ['planks'], muscleGroup: 'core', category: 'calisthenics', mode: 'hold' },

  // Yoga — timed poses
  { name: 'Downward Dog',       aliases: ['downward facing dog', 'down dog'], muscleGroup: 'other', category: 'yoga', mode: 'hold' },
  { name: 'Warrior II',         aliases: ['warrior 2', 'warrior two'], muscleGroup: 'other', category: 'yoga', mode: 'hold' },
  { name: "Child's Pose",       aliases: ['childs pose', 'child pose'], muscleGroup: 'other', category: 'yoga', mode: 'hold' },

  // Pilates — a mix of timed holds and counted reps
  { name: 'The Hundred',        aliases: ['hundred', 'the 100'], muscleGroup: 'core', category: 'pilates', mode: 'hold' },
  { name: 'Roll Up',            aliases: ['roll-up', 'rollup', 'roll ups'], muscleGroup: 'core', category: 'pilates', isBodyweight: true },
  { name: 'Plank Series',       aliases: ['pilates plank'], muscleGroup: 'core', category: 'pilates', mode: 'hold' }
];
