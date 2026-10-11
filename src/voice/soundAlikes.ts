/**
 * Undoes the recogniser's usual mishearings of anatomical words before the
 * transcript is matched.
 *
 * A general-purpose speech model knows "erotic" far better than "aortic", so
 * medical terms come back as their everyday sound-alikes. Two repairs:
 *
 *  1. A table of known mishearings, rewritten to the intended word. Add to it
 *     from what the panel shows under "heard" when a command misses.
 *  2. Words split in two ("try cuspid", "sub clavian") are joined back when the
 *     pair, run together, is within a letter of a vocabulary word and neither
 *     half is a vocabulary word on its own.
 */
const MISHEARINGS: Array<[RegExp, string]> = [
  [/\b(?:try|tri|tree|chai) ?(?:cuspid|cusp it|custard|cuss bid|cospid)\b/g, 'tricuspid'],
  [/\b(?:my ?tral|mitra|mitre|metral|nitral|metro|mi trail|my trail)\b(?= valve|$| please)/g, 'mitral'],
  [/\bmitral?\b/g, 'mitral'],
  [/\b(?:erotic|a ortic|aortica|eortic|heroic|a erotic)\b/g, 'aortic'],
  [/\b(?:a order|aorto|ayorta|a orta|oarta|eorta|aortaa)\b/g, 'aorta'],
  [/\b(?:a tree ?um|atrium|eight ?rium|a trium|atreum|atrion|a trim)\b/g, 'atrium'],
  [/\b(?:ventrical|ventricals|vent ?ricle|ventricule|ventricles|ventical|ventricals)\b/g, 'ventricle'],
  [/\b(?:vena|veena|vina|vino|weena|wena|bena) ?(?:cava|kava|kaava|carver|cover)\b/g, 'vena cava'],
  [/\b(?:pull|pul|pal) ?(?:monary|monetary|manary|minary)\b|\bpulmonery\b|\bpulmonory\b/g, 'pulmonary'],
  [/\b(?:oracle|oricle|auricular|or ?ical|orical)\b/g, 'auricle'],
  [/\b(?:septem|sceptum|sep ?tum|septa)\b/g, 'septum'],
  [/\b(?:ape x|apex|a pecs|apax|apic)\b/g, 'apex'],
  [/\b(?:carrot ?id|carotene|corrode it|karate|carotids)\b/g, 'carotid'],
  [/\b(?:sub ?clavin|sub ?clavian|sub ?clavicle)\b/g, 'subclavian'],
  [/\b(?:brachy|bracky|bracki|brake ?y) ?(?:cephalic|sefalic|ce falic)\b/g, 'brachiocephalic'],
  [/\b(?:in ?nominate|innominet)\b/g, 'innominate'],
  [/\b(?:ex ?ray|x ?rays|xrays|eks ray)\b/g, 'x ray'],
  [/\b(?:kiss me|quiz mi|quizz me|quiz mein)\b/g, 'quiz me'],
  [/\b(?:el ?v|elvee|elvie|l\.v\.?)\b/g, 'lv'],
  [/\b(?:are ?v|r\.v\.?)\b/g, 'rv'],
  [/\bseptal\b/g, 'septum'],
];

export function repairHearing(text: string): string {
  let out = text.toLowerCase();
  for (const [pattern, replacement] of MISHEARINGS) out = out.replace(pattern, replacement);
  return out;
}

/**
 * Joins a word the recogniser split in two back into the vocabulary word it
 * was. `vocabulary` is every single word that appears in any phrase.
 */
export function joinSplitWords(tokens: string[], vocabulary: Set<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i]!;
    const b = tokens[i + 1];
    if (b !== undefined && !vocabulary.has(a) && !vocabulary.has(b)) {
      const joined = a + b;
      const word = closestWord(joined, vocabulary);
      if (word) {
        out.push(word);
        i++;
        continue;
      }
    }
    out.push(a);
  }
  return out;
}

function closestWord(joined: string, vocabulary: Set<string>): string | null {
  if (joined.length < 6) return null;
  if (vocabulary.has(joined)) return joined;
  for (const word of vocabulary) {
    if (word.length < 6 || Math.abs(word.length - joined.length) > 1) continue;
    if (within1(joined, word)) return word;
  }
  return null;
}

/** True when two words differ by at most one insertion, deletion or substitution. */
function within1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * Words worth hinting to a recogniser that accepts phrase hints: the part
 * names it is least likely to know.
 */
export const HINT_PHRASES = [
  'tricuspid valve',
  'mitral valve',
  'aortic valve',
  'pulmonary valve',
  'aortic arch',
  'aorta',
  'superior vena cava',
  'pulmonary trunk',
  'pulmonary artery',
  'pulmonary veins',
  'left atrium',
  'right atrium',
  'left ventricle',
  'right ventricle',
  'auricle',
  'apex',
  'interventricular septum',
  'interatrial septum',
  'brachiocephalic trunk',
  'left common carotid',
  'left subclavian',
  'descending aorta',
  'ascending aorta',
  'x-ray',
  'follow the blood',
  'quiz me',
];
