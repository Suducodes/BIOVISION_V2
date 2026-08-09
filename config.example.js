/**
 * SurgiLearn runtime configuration — TEMPLATE.
 *
 * Copy this file to `public/config.js` and fill in your key:
 *
 *     cp config.example.js public/config.js
 *
 * `public/config.js` is gitignored, so your key never enters the repository.
 * Without it the platform runs exactly as it does now; only the AI clinical
 * debrief stays in its placeholder state.
 *
 * SECURITY: a key placed here is readable by anyone who loads the page, so
 * only ever use a throwaway key with a hard spend limit, and never commit one
 * to a public deployment. See README_SURGILEARN.md → "Configuring the Claude
 * API key" for the proxy pattern to use in a shared deployment.
 */
window.SURGILEARN_CONFIG = {
  // Anthropic API key, e.g. 'sk-ant-...'. Leave empty to keep the tutor offline.
  anthropicApiKey: '',

  // Model used for the clinical debrief.
  model: 'claude-opus-5',
};
