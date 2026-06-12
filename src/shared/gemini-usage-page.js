/**
 * Parse quota buckets from gemini.google.com/usage (official usage UI).
 */
const { clampPercent } = require('./normalize');

const GEMINI_USAGE_PAGE_URL = 'https://gemini.google.com/usage?pageId=none';

/** Browser-side collector for the /usage page (progress bars + nearby labels). */
const GEMINI_USAGE_PAGE_COLLECTOR = `(() => {
  const buckets = [];
  const seen = new Set();
  const push = (label, used, limit) => {
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return;
    const key = label + ':' + used + '/' + limit;
    if (seen.has(key)) return;
    seen.add(key);
    buckets.push({ label: String(label || '').slice(0, 120), used, limit });
  };

  for (const el of document.querySelectorAll('[role="progressbar"], progress, meter')) {
    const now = Number(el.getAttribute('aria-valuenow') ?? el.value);
    const max = Number(el.getAttribute('aria-valuemax') ?? el.max);
    const label = el.getAttribute('aria-label')
      || el.closest('[class*="usage"], section, article, div')?.querySelector('h1,h2,h3,h4,strong')?.textContent
      || '';
    if (Number.isFinite(now) && Number.isFinite(max)) push(label.trim(), now, max);
  }

  const bodyText = document.body?.innerText || '';
  const lines = bodyText.split(/\\n+/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const label = lines[i - 1] || lines[i + 1] || '';
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

  return { buckets, pageText: bodyText.slice(0, 12000), html: parts.join('\\n').slice(0, 200000) };
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

function classifyBucketKey(label = '') {
  const text = String(label).toLowerCase();
  if (/ultra|deep.?research/.test(text)) return 'ultra';
  if (/pro|3\.1 pro|advanced/.test(text)) return 'pro';
  if (/thinking|deep think/.test(text)) return 'thinking';
  if (/flash|fast/.test(text)) return 'flash';
  if (/image|veo|video/.test(text)) return 'media';
  return 'day';
}

function bucketLabelForKey(key) {
  const labels = {
    pro: 'PRO',
    thinking: 'THINKING',
    flash: 'FLASH',
    ultra: 'ULTRA',
    media: 'MEDIA',
    day: 'DAY',
  };
  return labels[key] || key.toUpperCase();
}

function normalizeBucket(label, used, limit) {
  if (!isPlausiblePair(used, limit)) return null;
  const key = classifyBucketKey(label);
  return {
    key,
    label: bucketLabelForKey(key),
    used,
    limit,
    utilization: clampPercent((used / limit) * 100),
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

function mergeBuckets(primary = [], secondary = []) {
  const byKey = new Map();
  for (const bucket of [...primary, ...secondary]) {
    if (!bucket) continue;
    const prev = byKey.get(bucket.key);
    if (!prev || bucket.limit > prev.limit) byKey.set(bucket.key, bucket);
  }
  const pro = byKey.get('pro');
  const day = byKey.get('day');
  if (pro && day && pro.used === day.used && pro.limit === day.limit) {
    byKey.delete('day');
  }
  return [...byKey.values()];
}

/**
 * @param {{ buckets?: Array<{label?: string, used?: number, limit?: number}>, html?: string, pageText?: string }} payload
 * @returns {{ windows: Array<{ key: string, label: string, utilization: number, used: number, limit: number }>, buckets: object[] }}
 */
function parseGeminiUsagePageSource(payload = {}) {
  const fromDom = (payload.buckets || [])
    .map((b) => normalizeBucket(b.label, Number(b.used), Number(b.limit)))
    .filter(Boolean);
  const fromHtml = parseQuotaFromHtml(payload.html || payload.pageText || '');
  const merged = mergeBuckets(fromDom, fromHtml);

  const windows = merged.map((b) => ({
    key: b.key,
    label: b.label,
    utilization: b.utilization,
    used: b.used,
    limit: b.limit,
  }));

  return { windows, buckets: merged };
}

function mapUsagePageToSnapshot(windows, { plan } = {}) {
  if (!windows?.length) return null;
  const end = new Date();
  end.setUTCHours(24, 0, 0, 0);
  const resetsAt = end.toISOString();
  return {
    windows: windows.map((w) => ({
      key: w.key,
      label: w.label,
      utilization: w.utilization,
      resetsAt,
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
};