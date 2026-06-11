let thresholds = { warnThreshold: 75, dangerThreshold: 90 };

export function setAlertThresholds({ warnThreshold, dangerThreshold } = {}) {
  if (Number.isFinite(warnThreshold)) thresholds.warnThreshold = warnThreshold;
  if (Number.isFinite(dangerThreshold)) thresholds.dangerThreshold = dangerThreshold;
}

export function getAlertThresholds() {
  return { ...thresholds };
}

export function thresholdClass(util) {
  const { warnThreshold, dangerThreshold } = thresholds;
  if (util >= dangerThreshold) return 'red';
  if (util >= warnThreshold) return 'amber';
  return 'green';
}