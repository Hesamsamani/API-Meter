/**
 * Parse quota buckets from gemini.google.com/usage (official usage UI).
 */
const { clampPercent } = require('./normalize');

const GEMINI_USAGE_PAGE_URL = 'https://gemini.google.com/usage?pageId=none';

const WINDOW_ORDER = ['current', 'weekly', 'pro', 'thinking', 'flash', 'ultra', 'media', 'day'];

/** Browser-side collector for the /usage page (progress bars + nearby labels). */
const GEMINI_USAGE_PAGE_COLLECTOR = `(() => {
  const buckets = [];
  const resetTimes = {};
  const seen = new Set();
  const push = (label, used, limit, kind) => {
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return;
    const key = (kind || label) + ':' + used + '/' + limit;
    if (seen.has(key)) return;
    seen.add(key);
    buckets.push({
      label: String(label || '').slice(0, 120),
      used,
      limit,
      kind: kind || null,
    });
  };

  for (const el of document.querySelectorAll('[role="progressbar"], progress, meter')) {
    const now = Number(el.getAttribute('aria-valuenow') ?? el.value);
    const max = Number(el.getAttribute('aria-valuemax') ?? el.max);
    const label = el.getAttribute('aria-label')
      || el.closest('section, article, div')?.querySelector('h1,h2,h3,h4,strong')?.textContent
      || '';
    if (Number.isFinite(now) && Number.isFinite(max)) push(label.trim(), now, max);
  }

  const bodyText = document.body?.innerText || '';
  const lines = bodyText.split(/\\n+/).map((l) => l.trim()).filter(Boolean);

  const scanSection = (startIdx, headingRe, kind, label) => {
    let pct = null;
    let resetText = null;
    for (let j = startIdx; j < Math.min(startIdx + 8, lines.length); j += 1) {
      const pctMatch = lines[j].match(/(\\d+)%\\s*used/i);
      if (pctMatch) pct = Number(pctMatch[1]);
      const resetMatch = lines[j].match(/Resets?\\s+(?:at\\s+)?(.+)/i);
      if (resetMatch) resetText = resetMatch[1].trim();
    }
    if (pct != null) push(label, pct, 100, kind);
    if (resetText) resetTimes[kind] = resetText;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/current usage/i.test(line)) scanSection(i, /current usage/i, 'current', 'Current usage');
    if (/weekly limit/i.test(line)) scanSection(i, /weekly limit/i, 'weekly', 'Weekly limit');
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const label = lines[i - 1] || lines[i + 1] || '';
    const pctMatch = line.match(/(\\d+)%\\s*used/i);
    if (pctMatch && /current usage/i.test(label)) push('Current usage', Number(pctMatch[1]), 100, 'current');
    if (pctMatch && /weekly limit/i.test(label)) push('Weekly limit', Number(pctMatch[1]), 100, 'weekly');
    const ofMatch = line.match(/(\\d+)\\s*(?:of|\\/)\\s*(\\d+)/i);
    if (ofMatch) push(label, Number(ofMatch[1]), Number(ofMatch[2]));
    const remainMatch = line.match(/(\\d+)\\s+remaining/i);
    const limitMatch = line.match(/(?:out of|limit|of)\\s*(\\d+)/i);
    if (remainMatch && limitMatch) {
      const remaining = Number(remainMatch[1]);
      const limit = Number(limitMatch[1]);
      push(label, Math.max(0, limit - remaining), limit);
    }
  }

  const parts = [document.documentElement?.innerHTML || ''];
  for (const script of document.querySelectorAll('script')) {
    const text = script.textContent || '';
    if (/quota|promptLimit|promptCount|remainingFraction|usage/i.test(text)) parts.push(text);
  }
  try {
    if (window.WIZ_global_data) parts.push(JSON.stringify(window.WIZ_global_data));
  } catch {}

  return {
    buckets,
    resetTimes,
    pageText: bodyText.slice(0, 12000),
    html: parts.join('\\n').slice(0, 200000),
  };
})()`;

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isPlausiblePair(used, limit) {
  if (used == null || limit == null) return false;
  if (limit <= 0 || used < 0 || used > limit || limit > 1_000_000) return false;
  return true;
}

function classifyBucketKey(label = '', kind = '') {
  const kindText = String(kind || '').toLowerCase();
  if (kindText === 'current') return 'current';
  if (kindText === 'weekly') return 'weekly';

  const text = String(label).toLowerCase();
  if (/current usage|5.?hour|\b5h\b/.test(text)) return 'current';
  if (/weekly limit|weekly usage|\bweek\b/.test(text)) return 'weekly';
  if (/ultra|deep.?research/.test(text)) return 'ultra';
  if (/pro|3\.1 pro|advanced/.test(text)) return 'pro';
  if (/thinking|deep think/.test(text)) return 'thinking';
  if (/flash|fast/.test(text)) return 'flash';
  if (/image|veo|video/.test(text)) return 'media';
  return 'day';
}

function bucketLabelForKey(key) {
  const labels = {
    current: '5H',
    weekly: 'WEEK',
    pro: 'PRO',
    thinking: 'THINKING',
    flash: 'FLASH',
    ultra: 'ULTRA',
    media: 'MEDIA',
    day: 'DAY',
  };
  return labels[key] || key.toUpperCase();
}

function normalizeBucket(label, used, limit, kind) {
  if (!isPlausiblePair(used, limit)) return null;
  const key = classifyBucketKey(label, kind);
  const utilization = limit === 100 && used <= 100
    ? clampPercent(used)
    : clampPercent((used / limit) * 100);
  return {
    key,
    label: bucketLabelForKey(key),
    used,
    limit,
    utilization,
  };
}

function parseJsonQuotaNodes(node, out, depth = 0) {
  if (!node || depth > 12) return;
  if (Array.isArray(node)) {
    const nums = node.map(toFiniteNumber).filter((n) => n != null);
    if (nums.length >= 2 && isPlausiblePair(nums[0], nums[1])) {
      out.push(normalizeBucket('', nums[0], nums[1]));
    }
    for (const item of node) parseJsonQuotaNodes(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;

  const used = toFiniteNumber(
    node.used ?? node.dayUsed ?? node.promptCount ?? node.requestCount ?? node.count,
  );
  const limit = toFiniteNumber(
    node.limit ?? node.dayLimit ?? node.promptLimit ?? node.requestLimit ?? node.max,
  );
  const remaining = toFiniteNumber(node.remaining ?? node.remainingCount);
  const label = String(
    node.label ?? node.name ?? node.title ?? node.model ?? node.tier ?? node.bucket ?? '',
  );

  if (used != null && limit != null) {
    out.push(normalizeBucket(label, used, limit));
  } else if (remaining != null && limit != null) {
    out.push(normalizeBucket(label, Math.max(0, limit - remaining), limit));
  } else if (remaining != null && limit == null && node.remainingFraction != null) {
    const frac = toFiniteNumber(node.remainingFraction);
    if (frac != null && frac >= 0 && frac <= 1) {
      const inferredLimit = 100;
      out.push(normalizeBucket(label, Math.round((1 - frac) * inferredLimit), inferredLimit));
    }
  }

  for (const value of Object.values(node)) parseJsonQuotaNodes(value, out, depth + 1);
}

function parseQuotaFromHtml(html) {
  const text = String(html || '');
  const buckets = [];

  const namedPatterns = [
    { re: /"pro"[^}]{0,200}?"used"\s*:\s*(\d+)[^}]{0,200}?"limit"\s*:\s*(\d+)/i, label: 'Pro' },
    { re: /"thinking"[^}]{0,200}?"used"\s*:\s*(\d+)[^}]{0,200}?"limit"\s*:\s*(\d+)/i, label: 'Thinking' },
    { re: /"flash"[^}]{0,200}?"used"\s*:\s*(\d+)[^}]{0,200}?"limit"\s*:\s*(\d+)/i, label: 'Flash' },
    { re: /"dayUsed"\s*:\s*(\d+)[^}]{0,120}?"dayLimit"\s*:\s*(\d+)/i, label: 'Day' },
    { re: /"promptCount"\s*:\s*(\d+)[^}]{0,120}?"promptLimit"\s*:\s*(\d+)/i, label: 'Prompts' },
  ];
  for (const { re, label } of namedPatterns) {
    const match = text.match(re);
    if (match) buckets.push(normalizeBucket(label, Number(match[1]), Number(match[2])));
  }

  const jsonLike = text.match(/\{[^{}]{0,400}"(?:used|dayUsed|promptCount)"[^{}]{0,400}\}/g) || [];
  for (const chunk of jsonLike) {
    try {
      parseJsonQuotaNodes(JSON.parse(chunk), buckets);
    } catch {
      /* ignore partial json */
    }
  }

  return buckets.filter(Boolean);
}

function parseResetTimesFromPageText(pageText = '') {
  const resetTimes = {};
  const lines = String(pageText).split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const resetMatch = line.match(/Resets?\s+(?:at\s+)?(.+)/i);
    if (!resetMatch) continue;
    const resetText = resetMatch[1].trim();
    const prev = lines[i - 1] || '';
    const prev2 = lines[i - 2] || '';
    if (/weekly limit/i.test(prev2) || /weekly limit/i.test(prev)) {
      resetTimes.weekly = resetText;
    } else if (/current usage/i.test(prev2) || /current usage/i.test(prev) || /% used/i.test(prev)) {
      resetTimes.current = resetText;
    }
  }
  return resetTimes;
}

/**
 * Parse Gemini reset strings like "10:04 AM" or "Jun 16 at 11:04 AM".
 * @param {string} text
 * @param {Date} [now]
 */
function parseGeminiResetTime(text, now = new Date()) {
  if (!text) return null;
  const s = String(text).trim();

  const longMatch = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (longMatch) {
    const months = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const month = months[longMatch[1].slice(0, 3).toLowerCase()];
    if (month == null) return null;
    const day = Number(longMatch[2]);
    let hour = Number(longMatch[3]);
    const minute = Number(longMatch[4]);
    const ampm = longMatch[5];
    if (ampm) {
      if (/pm/i.test(ampm) && hour < 12) hour += 12;
      if (/am/i.test(ampm) && hour === 12) hour = 0;
    }
    const d = new Date(now);
    d.setMonth(month, day);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= now.getTime()) d.setFullYear(d.getFullYear() + 1);
    return d.toISOString();
  }

  const timeMatch = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const ampm = timeMatch[3];
    if (/pm/i.test(ampm) && hour < 12) hour += 12;
    if (/am/i.test(ampm) && hour === 12) hour = 0;
    const d = new Date(now);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }

  return null;
}

function mergeBuckets(primary = [], secondary = []) {
  const byKey = new Map();
  for (const bucket of [...primary, ...secondary]) {
    if (!bucket) continue;
    const prev = byKey.get(bucket.key);
    if (!prev || bucket.limit >= prev.limit) byKey.set(bucket.key, bucket);
  }

  const hasRolling = byKey.has('current') || byKey.has('weekly');
  if (hasRolling) {
    byKey.delete('day');
    const current = byKey.get('current');
    const pro = byKey.get('pro');
    if (current && pro && current.utilization === pro.utilization) byKey.delete('pro');
  } else {
    const pro = byKey.get('pro');
    const day = byKey.get('day');
    if (pro && day && pro.used === day.used && pro.limit === day.limit) byKey.delete('day');
  }

  return [...byKey.values()].sort((a, b) => {
    const ai = WINDOW_ORDER.indexOf(a.key);
    const bi = WINDOW_ORDER.indexOf(b.key);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

/**
 * @param {{ buckets?: Array<{label?: string, used?: number, limit?: number, kind?: string}>, html?: string, pageText?: string, resetTimes?: Record<string, string> }} payload
 */
function parseGeminiUsagePageSource(payload = {}) {
  const fromDom = (payload.buckets || [])
    .map((b) => normalizeBucket(b.label, Number(b.used), Number(b.limit), b.kind))
    .filter(Boolean);
  const fromHtml = parseQuotaFromHtml(payload.html || payload.pageText || '');
  const merged = mergeBuckets(fromDom, fromHtml);

  const resetTimes = {
    ...parseResetTimesFromPageText(payload.pageText || ''),
    ...(payload.resetTimes || {}),
  };

  const windows = merged.map((b) => ({
    key: b.key,
    label: b.label,
    utilization: b.utilization,
    used: b.used,
    limit: b.limit,
  }));

  return { windows, buckets: merged, resetTimes };
}

function defaultResetForKey(key) {
  if (key === 'weekly') {
    const d = new Date();
    const day = d.getDay();
    const daysUntilMonday = ((8 - day) % 7) || 7;
    d.setDate(d.getDate() + daysUntilMonday);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const d = new Date();
  d.setHours(d.getHours() + 5);
  return d.toISOString();
}

function mapUsagePageToSnapshot(windows, { resetTimes = {}, plan } = {}) {
  if (!windows?.length) return null;
  return {
    windows: windows.map((w) => ({
      key: w.key,
      label: w.label,
      utilization: w.utilization,
      resetsAt: parseGeminiResetTime(resetTimes[w.key]) || defaultResetForKey(w.key),
    })),
    plan: plan || null,
  };
}

module.exports = {
  GEMINI_USAGE_PAGE_URL,
  GEMINI_USAGE_PAGE_COLLECTOR,
  classifyBucketKey,
  parseGeminiUsagePageSource,
  mapUsagePageToSnapshot,
  mergeBuckets,
  parseGeminiResetTime,
  parseResetTimesFromPageText,
  bucketLabelForKey,
};