/* Starter exercise dictionary. Deliberately small — a big database is the thing
 * that makes other trackers slow to search. Users add their own in Exercises.
 * Aliases exist so the voice parser can match what people actually say.
 */

export const SEED_EXERCISES = [
  { name: 'Bench Press',        aliases: ['bench', 'flat bench', 'barbell bench press', 'bench press'], muscleGroup: 'chest' },
  { name: 'Incline Bench Press', aliases: ['incline bench', 'incline press'], muscleGroup: 'chest' },
  { name: 'Overhead Press',     aliases: ['ohp', 'shoulder press', 'military press', 'press'], muscleGroup: 'shoulders' },
  { name: 'Back Squat',         aliases: ['squat', 'squats', 'barbell squat', 'back squats'], muscleGroup: 'legs' },
  { name: 'Front Squat',        aliases: ['front squats'], muscleGroup: 'legs' },
  { name: 'Deadlift',           aliases: ['deadlifts', 'conventional deadlift', 'dead lift'], muscleGroup: 'back' },
  { name: 'Romanian Deadlift',  aliases: ['rdl', 'rdls', 'romanian deadlifts', 'stiff leg deadlift'], muscleGroup: 'back' },
  { name: 'Barbell Row',        aliases: ['row', 'rows', 'bent over row', 'pendlay row'], muscleGroup: 'back' },
  { name: 'Lat Pulldown',       aliases: ['pulldown', 'pulldowns', 'lat pull down'], muscleGroup: 'back' },
  { name: 'Pull Up',            aliases: ['pull ups', 'pullup', 'pullups', 'chin up', 'chin ups'], muscleGroup: 'back', isBodyweight: true },
  { name: 'Push Up',            aliases: ['push ups', 'pushup', 'pushups', 'press up', 'press ups'], muscleGroup: 'chest', isBodyweight: true },
  { name: 'Dip',                aliases: ['dips', 'parallel bar dips'], muscleGroup: 'chest', isBodyweight: true },
  { name: 'Leg Press',          aliases: ['leg presses'], muscleGroup: 'legs' },
  { name: 'Leg Curl',           aliases: ['hamstring curl', 'leg curls'], muscleGroup: 'legs' },
  { name: 'Leg Extension',      aliases: ['leg extensions', 'quad extension'], muscleGroup: 'legs' },
  { name: 'Dumbbell Curl',      aliases: ['bicep curl', 'biceps curl', 'curl', 'curls', 'dumbbell curls'], muscleGroup: 'arms' },
  { name: 'Tricep Pushdown',    aliases: ['pushdown', 'tricep push down', 'rope pushdown'], muscleGroup: 'arms' },
  { name: 'Lateral Raise',      aliases: ['lat raise', 'side raise', 'lateral raises'], muscleGroup: 'shoulders' },
  { name: 'Face Pull',          aliases: ['face pulls'], muscleGroup: 'shoulders' },
  { name: 'Hip Thrust',         aliases: ['hip thrusts', 'glute bridge'], muscleGroup: 'legs' },
  { name: 'Calf Raise',         aliases: ['calf raises', 'standing calf raise'], muscleGroup: 'legs' },
  { name: 'Plank',              aliases: ['planks'], muscleGroup: 'core', isBodyweight: true }
];
