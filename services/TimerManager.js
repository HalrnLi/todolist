// 定时器管理器类
class TimerManager {
  constructor() {
    this.timers = new Map(); // 使用 Map 存储 timer -> callback 映射
  }

  setTimeout(callback, delay) {
    const timer = setTimeout(() => {
      // 无论成功还是异常，都要清理
      this.timers.delete(timer);
      try {
        callback();
      } catch (error) {
        console.error('[TimerManager] Timer callback error:', error);
      }
    }, delay);
    this.timers.set(timer, callback);
    return timer;
  }

  clearAll() {
    for (const timer of this.timers.keys()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  getAllTimers() {
    return Array.from(this.timers.keys());
  }

  size() {
    return this.timers.size;
  }
}

module.exports = TimerManager;
