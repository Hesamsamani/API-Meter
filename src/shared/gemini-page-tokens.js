/**
 * Extract Google batchexecute tokens from gemini.google.com page HTML.
 * @param {string} html
 * @returns {{ at: string|null, sid: string|null, bl: string|null }}
 */
function extractGeminiPageTokens(html) {
  const text = String(html || '');
  const pick = (patterns) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1];
    }
    return null;
  };

  return {
    at: pick([
      /"SNlM0e":"([^"]+)"/,
      /'SNlM0e','([^']+)'/,
      /SNlM0e\\":\\"([^\\"]+)\\"/,
      /\\"SNlM0e\\":\\"([^\\"]+)\\"/,
      /SNlM0e":"([^"]+)"/,
    ]),
    sid: pick([
      /"FdrFJe":"([\d-]+)"/,
      /'FdrFJe','([\d-]+)'/,
      /FdrFJe\\":\\"([\d-]+)\\"/,
    ]),
    bl: (() => {
      const match = text.match(/boq_assistant-bard-web-server_[0-9A-Za-z._-]+/);
      return match ? match[0] : null;
    })(),
  };
}

module.exports = { extractGeminiPageTokens };