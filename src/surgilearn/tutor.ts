import type { CaseResult } from './engine';

/**
 * AI clinical tutor.
 *
 * The debrief is the point where the platform stops being a scoring toy and
 * starts teaching: a score tells a student *that* they missed something, an
 * examiner tells them *why it mattered*. Until a key is configured the panel
 * renders the placeholder shell, so the surrounding UX is demonstrable and
 * reviewable without anyone's credentials.
 *
 * The call is a direct browser fetch rather than the Anthropic SDK: the whole
 * platform ships as a static bundle to GitHub Pages with no build-time secrets
 * and no npm dependencies beyond three.js, and one JSON POST does not justify
 * breaking either property. See README_SURGILEARN.md for the key-handling
 * caveats that come with a browser-side key.
 */

export const DEBRIEF_PLACEHOLDER = '[ AI CLINICAL DEBRIEF WILL APPEAR HERE ]';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-opus-5';

export interface SurgiLearnConfig {
  anthropicApiKey?: string;
  model?: string;
}

declare global {
  interface Window {
    SURGILEARN_CONFIG?: SurgiLearnConfig;
  }
}

export type DebriefStatus = 'unconfigured' | 'ok' | 'error';

export interface Debrief {
  status: DebriefStatus;
  text: string;
  /** Populated when status is 'error'. */
  detail?: string;
}

export function isTutorConfigured(): boolean {
  return Boolean(window.SURGILEARN_CONFIG?.anthropicApiKey);
}

/** The tutor prompt, kept verbatim so the teaching voice is reproducible. */
export function buildPrompt(result: CaseResult): string {
  const completed = result.objectives
    .filter((o) => o.done)
    .map((o) => o.label)
    .join('; ');
  const missed = result.objectives
    .filter((o) => !o.done)
    .map((o) => o.label)
    .join('; ');

  return [
    'You are a surgical anatomy tutor. A medical student just completed a coronary anatomy challenge.',
    `Case: ${result.caseTitle} — ${result.brief}`,
    `Tasks completed: ${completed || 'none'}.`,
    missed ? `Tasks not completed: ${missed}.` : '',
    `Time: ${(result.timeMs / 1000).toFixed(0)} seconds.`,
    `Score: ${result.score}/100.`,
    `Classification given: ${result.classification ?? 'none'} (correct answer: ${result.correctAnswer}).`,
    `Incorrect grading attempts: ${result.wrongClassifications}. Off-target vessel identifications: ${result.offTargetIdentifications}.`,
    '',
    'Provide a 3-paragraph clinical debrief: (1) what they did well, (2) what they missed and why it matters clinically, (3) one key learning point about coronary anatomy for this case. Keep it concise, educational, and encouraging. Return plain prose with no headings or markdown.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function requestDebrief(result: CaseResult): Promise<Debrief> {
  const config = window.SURGILEARN_CONFIG;
  const apiKey = config?.anthropicApiKey;
  if (!apiKey) {
    return { status: 'unconfigured', text: DEBRIEF_PLACEHOLDER };
  }

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        // Required for a browser-origin request; without it the API rejects the
        // call rather than silently accepting a key exposed to the page.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: config?.model ?? DEFAULT_MODEL,
        max_tokens: 2048,
        // Low effort keeps the debrief responsive between cases; thinking stays
        // on (the default) because disabling it on Opus 5 risks reasoning
        // leaking into the visible text.
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: buildPrompt(result) }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        status: 'error',
        text: DEBRIEF_PLACEHOLDER,
        detail: `HTTP ${response.status} — ${shorten(body)}`,
      };
    }

    const payload = (await response.json()) as {
      stop_reason?: string;
      stop_details?: { category?: string | null } | null;
      content?: Array<{ type: string; text?: string }>;
    };

    // Check stop_reason before reading content: a refusal returns HTTP 200 with
    // an empty or partial content array.
    if (payload.stop_reason === 'refusal') {
      return {
        status: 'error',
        text: DEBRIEF_PLACEHOLDER,
        detail: `The model declined this request${
          payload.stop_details?.category ? ` (${payload.stop_details.category})` : ''
        }.`,
      };
    }

    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text!.trim())
      .join('\n\n')
      .trim();

    if (!text) {
      return { status: 'error', text: DEBRIEF_PLACEHOLDER, detail: 'Empty response.' };
    }
    return { status: 'ok', text };
  } catch (error) {
    return {
      status: 'error',
      text: DEBRIEF_PLACEHOLDER,
      detail: error instanceof Error ? error.message : 'Network request failed.',
    };
  }
}

function shorten(body: string): string {
  const trimmed = body.replace(/\s+/g, ' ').trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 180)}…` : trimmed;
}
