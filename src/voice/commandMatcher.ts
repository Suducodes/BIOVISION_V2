/**
 * Turns a transcript into one command.
 *
 * Speech recognition hands back free text — "uh show me the left ventricle
 * please" — and mishears the odd word, so phrases are found inside the
 * sentence with a small allowance for misheard letters. Three layers:
 *
 *  1. Intents ("x-ray", "quiz me", "turn around") and full part names ("left
 *     ventricle") are matched as whole phrases. When a sentence holds several,
 *     the one spoken last wins: in a continuous stream that is what the speaker
 *     means now.
 *  2. Failing a full name, single words still count if they point at few
 *     enough parts: "superior" can only mean the superior vena cava, "carotid"
 *     only the carotid. Each heard word narrows the set of parts whose names
 *     contain it.
 *  3. If that leaves two to six parts ("ventricle", "valve", "pulmonary"), the
 *     result is a question back to the speaker, and their next words are
 *     matched against just those parts: "valve" → "which one?" → "mitral".
 */

export type Intent =
  | 'reset'
  | 'xray-on'
  | 'xray-off'
  | 'atlas-on'
  | 'atlas-off'
  | 'flow-on'
  | 'flow-off'
  | 'tour'
  | 'quiz'
  | 'next'
  | 'previous'
  | 'stop'
  | 'repeat'
  | 'describe'
  | 'help'
  | 'view-front'
  | 'view-back'
  | 'view-left'
  | 'view-right'
  | 'view-top'
  | 'view-bottom'
  | 'rotate-left'
  | 'rotate-right'
  | 'rotate-up'
  | 'rotate-down'
  | 'spin'
  | 'spin-stop'
  | 'zoom-in'
  | 'zoom-out'
  | 'mute'
  | 'unmute'
  | 'slow'
  | 'normal-speed'
  | 'pause-beat'
  | 'resume-beat'
  | 'dont-know';

export type VoiceCommand =
  | { kind: 'target'; id: string; inside?: boolean; describe?: boolean }
  | { kind: 'clarify'; ids: string[]; word: string }
  | { kind: 'intent'; intent: Intent }
  | { kind: 'organ'; id: string };

export interface VocabularyTarget {
  id: string;
  label: string;
  aliases: string[];
}

export interface Vocabulary {
  targets: VocabularyTarget[];
  organs: Array<{ id: string; label: string }>;
}

export interface MatchContext {
  /** Parts offered in a clarifying question still awaiting an answer. */
  pending?: string[];
}

export interface Match {
  command: VoiceCommand;
  /** The vocabulary phrase that matched, for display. */
  phrase: string;
  /**
   * A whole phrase matched. Partial matches can be beaten by the next few
   * words ("left" → "left ventricle"), so they wait for the speaker to finish.
   */
  confident: boolean;
}

import { joinSplitWords, repairHearing } from './soundAlikes';

/** Each phrase maps to one intent. Longer phrases win ties, so "zoom out" beats "zoom". */
const INTENT_PHRASES: Array<[string, Intent]> = [
  ['reset', 'reset'],
  ['reset view', 'reset'],
  ['whole heart', 'reset'],
  ['entire heart', 'reset'],
  ['full view', 'reset'],
  ['overview', 'reset'],
  ['show all', 'reset'],
  ['show everything', 'reset'],
  ['start over', 'reset'],
  ['clear selection', 'reset'],
  ['zoom all the way out', 'reset'],

  ['x ray', 'xray-on'],
  ['inside', 'xray-on'],
  ['xray', 'xray-on'],
  ['x-ray', 'xray-on'],
  ['show inside', 'xray-on'],
  ['show me inside', 'xray-on'],
  ['show the inside', 'xray-on'],
  ['see inside', 'xray-on'],
  ['look inside', 'xray-on'],
  ['go inside', 'xray-on'],
  ['inside view', 'xray-on'],
  ['see through', 'xray-on'],
  ['transparent', 'xray-on'],
  ['glass', 'xray-on'],
  ['x ray off', 'xray-off'],
  ['xray off', 'xray-off'],
  ['solid', 'xray-off'],
  ['opaque', 'xray-off'],
  ['hide inside', 'xray-off'],
  ['outside view', 'xray-off'],
  ['normal view', 'xray-off'],

  ['labels', 'atlas-on'],
  ['show labels', 'atlas-on'],
  ['label everything', 'atlas-on'],
  ['label it', 'atlas-on'],
  ['atlas', 'atlas-on'],
  ['name everything', 'atlas-on'],
  ['name the parts', 'atlas-on'],
  ['colour code', 'atlas-on'],
  ['color code', 'atlas-on'],
  ['show the parts', 'atlas-on'],
  ['show parts', 'atlas-on'],
  ['hide labels', 'atlas-off'],
  ['labels off', 'atlas-off'],
  ['no labels', 'atlas-off'],
  ['remove labels', 'atlas-off'],

  ['blood flow', 'flow-on'],
  ['show blood flow', 'flow-on'],
  ['show the blood flow', 'flow-on'],
  ['show the flow', 'flow-on'],
  ['show circulation', 'flow-on'],
  ['circulation', 'flow-on'],
  ['hide flow', 'flow-off'],
  ['hide the flow', 'flow-off'],
  ['flow off', 'flow-off'],
  ['hide blood', 'flow-off'],

  ['tour', 'tour'],
  ['guided tour', 'tour'],
  ['take the tour', 'tour'],
  ['follow the blood', 'tour'],
  ['take me through', 'tour'],
  ['walk me through', 'tour'],
  ['how does blood flow', 'tour'],
  ['how does the blood flow', 'tour'],
  ['journey', 'tour'],

  ['quiz', 'quiz'],
  ['quiz me', 'quiz'],
  ['test me', 'quiz'],
  ['test my knowledge', 'quiz'],
  ['challenge me', 'quiz'],

  ['next', 'next'],
  ['next one', 'next'],
  ['continue', 'next'],
  ['go on', 'next'],
  ['carry on', 'next'],
  ['skip', 'next'],
  ['previous', 'previous'],
  ['go back', 'previous'],
  ['last one', 'previous'],
  ['stop', 'stop'],
  ['end tour', 'stop'],
  ['end quiz', 'stop'],
  ['exit', 'stop'],
  ['quit', 'stop'],
  ['cancel', 'stop'],
  ['quiet', 'stop'],
  ['be quiet', 'stop'],
  ['enough', 'stop'],
  ['repeat', 'repeat'],
  ['say again', 'repeat'],
  ['say that again', 'repeat'],
  ['pardon', 'repeat'],
  ['what is this', 'describe'],
  ['what is that', 'describe'],
  ['whats this', 'describe'],
  ['what am i looking at', 'describe'],
  ['tell me about it', 'describe'],
  ['tell me more', 'describe'],
  ['explain', 'describe'],
  ['explain this', 'describe'],
  ['describe', 'describe'],
  ['describe this', 'describe'],
  ['help', 'help'],
  ['what can i say', 'help'],
  ['what can you do', 'help'],
  ['commands', 'help'],

  ['front view', 'view-front'],
  ['anterior view', 'view-front'],
  ['show the front', 'view-front'],
  ['from the front', 'view-front'],
  ['back view', 'view-back'],
  ['posterior view', 'view-back'],
  ['show the back', 'view-back'],
  ['from the back', 'view-back'],
  ['from behind', 'view-back'],
  ['turn around', 'view-back'],
  ['turn it around', 'view-back'],
  ['flip it', 'view-back'],
  ['flip', 'view-back'],
  ['left side', 'view-left'],
  ['left view', 'view-left'],
  ['left lateral', 'view-left'],
  ['from the left', 'view-left'],
  ['right side', 'view-right'],
  ['right view', 'view-right'],
  ['right lateral', 'view-right'],
  ['from the right', 'view-right'],
  ['top view', 'view-top'],
  ['from above', 'view-top'],
  ['from the top', 'view-top'],
  ['superior view', 'view-top'],
  ['bottom view', 'view-bottom'],
  ['from below', 'view-bottom'],
  ['from underneath', 'view-bottom'],
  ['inferior view', 'view-bottom'],

  ['rotate left', 'rotate-left'],
  ['turn left', 'rotate-left'],
  ['spin left', 'rotate-left'],
  ['rotate right', 'rotate-right'],
  ['turn right', 'rotate-right'],
  ['spin right', 'rotate-right'],
  ['rotate up', 'rotate-up'],
  ['tilt up', 'rotate-up'],
  ['tilt back', 'rotate-up'],
  ['rotate down', 'rotate-down'],
  ['tilt down', 'rotate-down'],
  ['tilt forward', 'rotate-down'],
  ['spin', 'spin'],
  ['spin it', 'spin'],
  ['rotate', 'spin'],
  ['turntable', 'spin'],
  ['keep rotating', 'spin'],
  ['stop spinning', 'spin-stop'],
  ['stop rotating', 'spin-stop'],
  ['hold still', 'spin-stop'],
  ['freeze', 'spin-stop'],

  ['zoom in', 'zoom-in'],
  ['closer', 'zoom-in'],
  ['get closer', 'zoom-in'],
  ['come closer', 'zoom-in'],
  ['magnify', 'zoom-in'],
  ['enlarge', 'zoom-in'],
  ['zoom out', 'zoom-out'],
  ['further', 'zoom-out'],
  ['farther', 'zoom-out'],
  ['back out', 'zoom-out'],
  ['pull back', 'zoom-out'],

  ['mute', 'mute'],
  ['silent', 'mute'],
  ['stop talking', 'mute'],
  ['no voice', 'mute'],
  ['unmute', 'unmute'],
  ['speak', 'unmute'],
  ['talk to me', 'unmute'],
  ['voice on', 'unmute'],

  ['slow motion', 'slow'],
  ['slow down', 'slow'],
  ['slowly', 'slow'],
  ['normal speed', 'normal-speed'],
  ['real time', 'normal-speed'],
  ['speed up', 'normal-speed'],
  ['stop the heart', 'pause-beat'],
  ['pause the heart', 'pause-beat'],
  ['stop beating', 'pause-beat'],
  ['pause heartbeat', 'pause-beat'],
  ['start the heart', 'resume-beat'],
  ['restart the heart', 'resume-beat'],
  ['start beating', 'resume-beat'],
  ['heartbeat', 'resume-beat'],

  ['i dont know', 'dont-know'],
  ['i do not know', 'dont-know'],
  ['no idea', 'dont-know'],
  ['give up', 'dont-know'],
  ['pass', 'dont-know'],
  ['tell me', 'dont-know'],
  ['reveal', 'dont-know'],
];

/** Intents that add to a named part instead of competing with it. */
const MODIFIERS = new Set<Intent>(['xray-on', 'describe']);

const ORGAN_VERBS = ['show', 'show the', 'open', 'switch to', 'go to', 'load', 'display'];

/**
 * Words too common to point at a part on their own. They still count inside a
 * full name, and as tie-breakers: "left" alone means nothing, but "left" after
 * "which ventricle?" means the left one.
 */
const FILLER = new Set(
  (
    'a an the of to in on into at and or is are be it its this that these those me my i we you us your ' +
    'show see look go take zoom display find where what whats which please can could would will now then ' +
    'focus highlight select open um uh er okay ok hey so just let lets like want need tell about bring ' +
    'part parts region area bit one heart hearts cardiac do does how there here up down get give with'
  ).split(' '),
);

/** Words that only narrow an existing choice; never enough to name a part. */
const NARROWING = new Set(['left', 'right', 'main', 'common', 'artery', 'arteries', 'vein']);

export function matchCommand(transcript: string, vocab: Vocabulary, context: MatchContext = {}): Match | null {
  const words = new Set<string>();
  for (const [phrase] of INTENT_PHRASES) for (const w of tokenise(phrase)) words.add(w);
  for (const t of vocab.targets) for (const alias of t.aliases) for (const w of tokenise(alias)) words.add(w);
  const tokens = joinSplitWords(tokenise(repairHearing(transcript)), words);
  if (tokens.length === 0) return null;

  type Found = { command: VoiceCommand; phrase: string; start: number; end: number; length: number; inexact: number };
  const intents: Found[] = [];
  const targets: Found[] = [];
  const organs: Found[] = [];

  for (const [phrase, intent] of INTENT_PHRASES) {
    const at = lastMatch(tokens, tokenise(phrase));
    if (at) intents.push({ command: { kind: 'intent', intent }, phrase, ...at, length: phrase.length });
  }
  for (const target of vocab.targets) {
    for (const alias of target.aliases) {
      const at = lastMatch(tokens, tokenise(alias));
      if (at) targets.push({ command: { kind: 'target', id: target.id }, phrase: alias, ...at, length: alias.length });
    }
  }
  for (const organ of vocab.organs) {
    const label = organ.label.toLowerCase();
    for (const verb of ORGAN_VERBS) {
      const phrase = `${verb} ${label}`;
      const at = lastMatch(tokens, tokenise(phrase));
      if (at) organs.push({ command: { kind: 'organ', id: organ.id }, phrase, ...at, length: phrase.length });
    }
    // "heart" on its own turns up in "whole heart", "of the heart" and the
    // like, so it only counts with a verb; the other organs are distinctive.
    if (label !== 'heart') {
      const at = lastMatch(tokens, [label]);
      if (at) organs.push({ command: { kind: 'organ', id: organ.id }, phrase: label, ...at, length: label.length });
    }
  }

  // Latest first; then the one heard exactly ("quit" is a near-miss for
  // "quiz" but an exact "quit"); then the longer, more specific phrase.
  const latest = (list: Found[]) =>
    [...list].sort((a, b) => b.end - a.end || a.inexact - b.inexact || b.length - a.length)[0];
  // A phrase that sits inside a longer match is part of it, not a command of
  // its own: "pulmonary valve" contains no "valve" command, "x-ray off" no "x-ray".
  // A misheard longer phrase does not swallow an exact shorter one: "ascending"
  // is one edit from "descending", but was said exactly.
  const swallowed = (f: Found, list: Found[]) =>
    list.some((g) => g !== f && covers(g, f) && g.length > f.length && g.inexact <= f.inexact);
  const bestIntent = latest(intents.filter((f) => !swallowed(f, intents)));
  const bestTarget = latest(targets.filter((f) => !swallowed(f, targets)));
  const bestOrgan = latest(organs);

  const modifiers = (from: Found[]) => {
    const kinds = new Set(from.map((f) => (f.command as { intent: Intent }).intent));
    return { inside: kinds.has('xray-on'), describe: kinds.has('describe') || /\b(what|tell|explain|describe)\b/.test(transcript.toLowerCase()) };
  };

  if (bestTarget && bestTarget.command.kind === 'target') {
    const intentWins =
      bestIntent && !MODIFIERS.has((bestIntent.command as { intent: Intent }).intent) && bestIntent.end > bestTarget.end && !covers(bestTarget, bestIntent);
    if (!intentWins && !(bestOrgan && bestOrgan.end > bestTarget.end)) {
      return {
        command: { kind: 'target', id: bestTarget.command.id, ...modifiers(intents) },
        phrase: bestTarget.phrase,
        confident: true,
      };
    }
  }
  if (bestOrgan && (!bestIntent || bestOrgan.end >= bestIntent.end)) {
    return { command: bestOrgan.command, phrase: bestOrgan.phrase, confident: true };
  }

  // No full name. Narrow the parts by the words that were said, ignoring words
  // already used up by an intent ("rotate left" says nothing about the left atrium).
  const used = new Set<number>();
  if (bestIntent) for (let i = bestIntent.start; i <= bestIntent.end; i++) used.add(i);
  const partial = narrow(tokens, used, vocab.targets, context.pending);

  if (partial && partial.ids.length === 1) {
    // A lone word only names a part if it is distinctive; inside a pending
    // question, any word that settles the choice will do.
    const settled = context.pending !== undefined || !partial.narrowingOnly;
    if (settled && !(bestIntent && !MODIFIERS.has((bestIntent.command as { intent: Intent }).intent))) {
      return {
        command: { kind: 'target', id: partial.ids[0]!, ...modifiers(intents) },
        phrase: partial.words.join(' '),
        confident: false,
      };
    }
  }

  if (bestIntent) return { command: bestIntent.command, phrase: bestIntent.phrase, confident: true };

  if (partial && partial.ids.length >= 2 && partial.ids.length <= 6 && !partial.narrowingOnly) {
    return {
      command: { kind: 'clarify', ids: partial.ids, word: partial.words.join(' ') },
      phrase: partial.words.join(' '),
      confident: false,
    };
  }
  return null;
}

/**
 * The parts whose names contain every informative word heard. Starts from the
 * pending question's choices when there is one, so "left" after "which
 * ventricle?" picks the left ventricle.
 */
function narrow(
  tokens: string[],
  used: Set<number>,
  targets: VocabularyTarget[],
  pending?: string[],
): { ids: string[]; words: string[]; narrowingOnly: boolean } | null {
  let pool = pending ? targets.filter((t) => pending.includes(t.id)) : targets;
  const words: string[] = [];
  let narrowingOnly = true;
  tokens.forEach((token, i) => {
    if (used.has(i) || FILLER.has(token)) return;
    const hit = pool.filter((t) => t.aliases.some((alias) => tokenise(alias).some((w) => wordsMatch(token, w))));
    // A word nothing in the pool contains is noise, not a filter that empties it.
    if (hit.length === 0) return;
    pool = hit;
    words.push(token);
    if (!NARROWING.has(token)) narrowingOnly = false;
  });
  if (words.length === 0) return null;
  return { ids: pool.map((t) => t.id), words, narrowingOnly };
}

function covers(outer: { start: number; end: number }, inner: { start: number; end: number }): boolean {
  return outer.start <= inner.start && outer.end >= inner.end;
}

/** Lower-case words only: punctuation and digits become spaces; "x-ray" stays one word. */
export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/x-ray/g, 'xray')
    .replace(/[’']/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** The last place `phrase` occurs in `tokens`, as token indices, or null. */
function lastMatch(tokens: string[], phrase: string[]): { start: number; end: number; inexact: number } | null {
  if (phrase.length === 0 || phrase.length > tokens.length) return null;
  for (let start = tokens.length - phrase.length; start >= 0; start--) {
    let ok = true;
    let inexact = 0;
    for (let k = 0; k < phrase.length; k++) {
      const heard = tokens[start + k]!;
      if (!wordsMatch(heard, phrase[k]!)) {
        ok = false;
        break;
      }
      if (heard !== phrase[k]) inexact++;
    }
    if (ok) return { start, end: start + phrase.length - 1, inexact };
  }
  return null;
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
  // A four-letter word must at least start right: "lift" is "left", but
  // "your" is not "tour".
  if (wanted.length === 4 && heard[0] !== wanted[0]) return false;
  // Plurals and "-al" endings: "ventricles", "atrial".
  if (heard.startsWith(wanted) && heard.length - wanted.length <= 2) return true;
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

/** Every intent phrase, for tests and the help card. */
export const INTENTS: ReadonlyArray<readonly [string, Intent]> = INTENT_PHRASES;
