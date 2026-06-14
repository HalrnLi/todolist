const { Notice } = require('obsidian');

class ReminderService {
  constructor(timerManager, plugin) {
    this.timerManager = timerManager;
    this.plugin = plugin;
    this.reminders = new Map(); // taskId -> { timerId, fireAt, content, link }
    this._permissionRequested = false;
    this._visibilityHandler = null;
    this._setupVisibilityFallback();
  }

  // 请求通知权限（需在用户操作上下文中调用）
  async _requestPermission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    // 避免重复请求
    if (this._permissionRequested) return Notification.permission;
    this._permissionRequested = true;
    try {
      const result = await Notification.requestPermission();
      return result;
    } catch {
      return 'denied';
    }
  }

  // 页面从后台恢复时，检查是否有错过的提醒
  _setupVisibilityFallback() {
    this._visibilityHandler = () => {
      if (document.hidden) return;
      const now = Date.now();
      for (const [taskId, reminder] of this.reminders) {
        if (reminder.fireAt <= now) {
          clearTimeout(reminder.timerId);
          this.reminders.delete(taskId);
          const task = this.plugin.findTaskById(taskId);
          if (task && task.completed) continue;
          const currentLink = task ? task.link : reminder.link;
          this._notify(taskId, reminder.content, currentLink);
        }
      }
      this._notifyViewsToRefresh();
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  // 设置提醒，返回 fireAt 时间戳
  async setReminder(taskId, content, delayMs, link) {
    // 如果已有提醒，先取消
    this.cancelReminder(taskId);

    const fireAt = Date.now() + delayMs;
    const timerId = this.timerManager.setTimeout(() => {
      try {
        const task = this.plugin.findTaskById(taskId);
        if (task && task.completed) return;
        const currentLink = task ? task.link : link;
        this._notify(taskId, content, currentLink);
      } finally {
        this.reminders.delete(taskId);
        this._notifyViewsToRefresh();
      }
    }, delayMs);

    // 先注册提醒（让图标立即显示），再异步请求权限
    this.reminders.set(taskId, { timerId, fireAt, content, link });

    // 在用户操作上下文中请求通知权限
    this._requestPermission();

    return fireAt;
  }

  // 更新提醒内容（不重置定时器）
  updateReminderContent(taskId, content, link) {
    const reminder = this.reminders.get(taskId);
    if (reminder) {
      reminder.content = content;
      reminder.link = link;
    }
  }

  // 取消提醒
  cancelReminder(taskId) {
    const reminder = this.reminders.get(taskId);
    if (!reminder) return false;
    // TimerManager 的 setTimeout 返回原生 timer ID，用 clearTimeout 取消
    clearTimeout(reminder.timerId);
    this.reminders.delete(taskId);
    return true;
  }

  // 查询是否有提醒
  hasReminder(taskId) {
    return this.reminders.has(taskId);
  }

  // 返回剩余毫秒数
  getRemainingTime(taskId) {
    const reminder = this.reminders.get(taskId);
    if (!reminder) return 0;
    return Math.max(0, reminder.fireAt - Date.now());
  }

  // 清除所有提醒
  clearAll() {
    for (const reminder of this.reminders.values()) {
      clearTimeout(reminder.timerId);
    }
    this.reminders.clear();
    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
  }

  // 触发通知
  _notify(taskId, content, link) {
    const safeLink = link ? this._sanitizeLink(link) : null;

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const body = safeLink ? `${content}\n${safeLink}` : content;
        const notification = new Notification('待办提醒', { body, requireInteraction: true });
        notification.onclick = () => {
          window.focus();
          if (safeLink) window.open(safeLink, '_blank');
          notification.close();
        };
        return;
      } catch (e) {
        // 系统通知失败，使用 Notice fallback
      }
    }

    // 使用 Obsidian Notice 作为 fallback（系统通知不可用时）
    const notice = new Notice(`⏰ 提醒: ${content}`, 0); // 0 = 不自动关闭
    if (safeLink) {
      // 创建一个可点击的容器元素
      const noticeEl = notice.noticeEl;
      if (noticeEl) {
        noticeEl.style.cursor = 'pointer';
        noticeEl.title = safeLink;
        noticeEl.addEventListener('click', () => {
          window.open(safeLink, '_blank');
        });
      }
    } else {
      // 没有链接时 10 秒后自动关闭
      setTimeout(() => notice.hide(), 10000);
    }
  }

  _sanitizeLink(link) {
    if (!link || typeof link !== 'string') return null;
    const trimmed = link.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return null;
  }

  // 通知视图刷新
  _notifyViewsToRefresh() {
    this.plugin.notifyViewsToRefresh();
  }
}

module.exports = ReminderService;
