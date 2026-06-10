const { createMockAdapter } = require('./mock');

function createRegistry() {
  const adapters = [
    createMockAdapter('claude-ai', 'CLAUDE'),
    createMockAdapter('claude-code', 'CODE'),
    createMockAdapter('gemini', 'GEMINI'),
    createMockAdapter('perplexity', 'PPLX'),
    createMockAdapter('grok', 'GROK'),
    createMockAdapter('cursor', 'CURSOR'),
  ];
  return {
    list() { return adapters; },
    get(id) { return adapters.find((a) => a.id === id) || null; },
  };
}

module.exports = { createRegistry };