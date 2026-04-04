// 定时器管理器类
class TimerManager {
  constructor() {
    this.timers = new Set();
  }

  setTimeout(callback, delay) {
    const timer = setTimeout(() => {
      callback();
      this.timers.delete(timer);
    }, delay);
    this.timers.add(timer);
    return timer;
  }

  clearAll() {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  getAllTimers() {
    return Array.from(this.timers);
  }

  size() {
    return this.timers.size;
  }
}

module.exports = TimerManager;
