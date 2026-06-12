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

  const at = pick([
    /"SNlM0e":"([^"]+)"/,
    /'SNlM0e','([^']+)'/,
    /SNlM0e\\":\\"([^\\"]+)\\"/,
    /\\"SNlM0e\\":\\"([^\\"]+)\\"/,
    /SNlM0e":"([^"]+)"/,
    /SNlM0e\\u003d\\u0022([^\\]+)\\u0022/,
    /SNlM0e%22%3A%22([^%]+)%22/,
    /"SNlM0e",\s*"([^"]+)"/,
    /SNlM0e\\",\\"([^\\]+)\\"/,
  ]);

  const sid = pick([
    /"FdrFJe":"([\d-]+)"/,
    /'FdrFJe','([\d-]+)'/,
    /FdrFJe\\":\\"([\d-]+)\\"/,
    /\\"FdrFJe\\":\\"([\d-]+)\\"/,
  ]);

  let bl = (() => {
    const match = text.match(/boq_assistant-bard-web-server_[0-9A-Za-z._-]+/);
    return match ? match[0] : null;
  })();

  if (!bl) {
    const blMatch = text.match(/"cfb2h":"(boq_assistant-bard-web-server_[^"]+)"/);
    if (blMatch?.[1]) bl = blMatch[1];
  }

  return { at, sid, bl };
}

/** Browser-side collector injected into hidden Gemini windows. */
const GEMINI_PAGE_SOURCE_COLLECTOR = `(() => {
  const parts = [document.documentElement?.innerHTML || ''];
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent || '';
    if (text.includes('SNlM0e') || text.includes('FdrFJe') || text.includes('boq_assistant-bard-web-server_')) {
      parts.push(text);
    }
  }
  try {
    if (window.WIZ_global_data) parts.push(JSON.stringify(window.WIZ_global_data));
  } catch {}
  return parts.join('\\n');
})()`;

module.exports = {
  extractGeminiPageTokens,
  GEMINI_PAGE_SOURCE_COLLECTOR,
};