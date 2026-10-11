export type VoiceCommand =
  | { kind: 'segment'; id: string }
  | { kind: 'organ'; id: string }
  | { kind: 'reset' };

export interface Vocabulary {
  segments: Array<{ id: string; aliases: string[] }>;
  organs: Array<{ id: string; label: string }>;
}

export interface Match {
  command: VoiceCommand;
  /** The vocabulary phrase that matched, for display. */
  phrase: string;
}

const RESET_PHRASES = [
  'reset',
  'zoom out',
  'whole heart',
  'entire heart',
  'full view',
  'overview',
  'show all',
  'show everything',
  'go back',
  'start over',
  'clear selection',
];

const ORGAN_VERBS = ['show', 'show the', 'open', 'switch to', 'go to', 'load', 'display'];

/**
 * Maps a transcript onto one command, or null if it says nothing we know.
 *
 * Speech recognition hands back free text — "uh show me the left ventricle
 * please" — and mishears the odd word, so matching is by phrase inside the
 * sentence, with a small allowance for misheard letters on longer words. When
 * a transcript contains several commands the one spoken last wins, since in a
 * continuous stream that is the one the speaker means now.
 */
export function matchCommand(transcript: string, vocab: Vocabulary): Match | null {
  const tokens = tokenise(transcript);
  if (tokens.length === 0) return null;

  type Candidate = Match & { end: number; length: number };
  const found: Candidate[] = [];

  const consider = (command: VoiceCommand, phrase: string) => {
    const end = lastMatchEnd(tokens, tokenise(phrase));
    if (end >= 0) found.push({ command, phrase, end, length: phrase.length });
  };

  for (const phrase of RESET_PHRASES) consider({ kind: 'reset' }, phrase);

  for (const segment of vocab.segments) {
    for (const alias of segment.aliases) {
      consider({ kind: 'segment', id: segment.id }, alias);
    }
  }

  for (const organ of vocab.organs) {
    const label = organ.label.toLowerCase();
    for (const verb of ORGAN_VERBS) consider({ kind: 'organ', id: organ.id }, `${verb} ${label}`);
    // "heart" on its own turns up in "whole heart", "of the heart" and the
    // like, so it only counts with a verb; the other organs are distinctive.
    if (label !== 'heart') consider({ kind: 'organ', id: organ.id }, label);
  }

  if (found.length === 0) return null;
  // Latest in the sentence first; between ties the longer, more specific phrase.
  found.sort((a, b) => b.end - a.end || b.length - a.length);
  const best = found[0]!;
  return { command: best.command, phrase: best.phrase };
}

/** Lower-case words only: punctuation and digits become spaces. */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Index of the last token of the final place `phrase` occurs in `tokens`, or -1.
 * Each phrase word must match its token within the typo allowance below.
 */
function lastMatchEnd(tokens: string[], phrase: string[]): number {
  if (phrase.length === 0 || phrase.length > tokens.length) return -1;
  for (let start = tokens.length - phrase.length; start >= 0; start--) {
    let ok = true;
    for (let k = 0; k < phrase.length; k++) {
      if (!wordsMatch(tokens[start + k]!, phrase[k]!)) {
        ok = false;
        break;
      }
    }
    if (ok) return start + phrase.length - 1;
  }
  return -1;
}

/**
 * Words of three letters or fewer must be exact; longer ones tolerate a
 * misheard letter, and long ones two. Four letters is the case that matters
 * most: "left" is routinely heard as "lift" or "lest".
 */
function wordsMatch(heard: string, wanted: string): boolean {
  if (heard === wanted) return true;
  const allowed = wanted.length >= 8 ? 2 : wanted.length >= 4 ? 1 : 0;
  if (allowed === 0) return false;
  return editDistance(heard, wanted, allowed) <= allowed;
}

/** Levenshtein distance, giving up early once it must exceed `limit`. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length]!;
}
