const { createClaudeAiAdapter } = require('./claude-ai');
const { createClaudeCodeAdapter } = require('./claude-code');
const { createGeminiAdapter } = require('./gemini');
const { createPerplexityAdapter } = require('./perplexity');
const { createGrokAdapter } = require('./grok');
const { createCursorAdapter } = require('./cursor');

function createRegistry() {
  const adapters = [
    createClaudeAiAdapter(),
    createClaudeCodeAdapter(),
    createGeminiAdapter(),
    createPerplexityAdapter(),
    createGrokAdapter(),
    createCursorAdapter(),
  ];
  return {
    list() { return adapters; },
    get(id) { return adapters.find((a) => a.id === id) || null; },
  };
}

module.exports = { createRegistry };