class AlertManager {
  constructor({ warn, danger, notify }) {
    this.warn = warn;
    this.danger = danger;
    this.notify = notify;
    this.state = new Map();
  }

  key(providerId, windowKey, level) {
    return `${providerId}:${windowKey}:${level}`;
  }

  evaluate(providerId, windowKey, utilization) {
    const levels = [];
    if (utilization >= this.danger) levels.push('danger');
    else if (utilization >= this.warn) levels.push('warn');
    else {
      for (const lvl of ['warn', 'danger']) this.state.delete(this.key(providerId, windowKey, lvl));
      return;
    }
    for (const lvl of levels) {
      const k = this.key(providerId, windowKey, lvl);
      if (this.state.get(k)) continue;
      this.state.set(k, true);
      this.notify(`${providerId} ${windowKey} at ${utilization}% (${lvl})`);
    }
  }
}

module.exports = { AlertManager };