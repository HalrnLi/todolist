const { Notice } = require('obsidian');

class ReminderService {
  constructor(timerManager, plugin) {
    this.timerManager = timerManager;
    this.plugin = plugin;
    this.reminders = new Map(); // taskId -> { timerId, fireAt, content }
    // 注意：不在构造时请求通知权限，避免插件一加载就弹权限框。
    // 改为在用户首次设置提醒时（setReminder）按需请求。
  }

  // 按需请求通知权限（仅在用户实际设置提醒时调用）
  _requestPermission() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // 设置提醒，返回 fireAt 时间戳
  setReminder(taskId, content, delayMs, link) {
    // 用户主动设置提醒时才请求通知权限
    this._requestPermission();

    // 如果已有提醒，先取消
    this.cancelReminder(taskId);

    const fireAt = Date.now() + delayMs;
    const timerId = this.timerManager.setTimeout(() => {
      try {
        // 已完成的任务不再弹提醒
        const task = this.plugin.findTaskById(taskId);
        if (task && task.completed) return;
        const currentLink = task ? task.link : link;
        this._notify(taskId, content, currentLink);
      } finally {
        this.reminders.delete(taskId);
        this._notifyViewsToRefresh();
      }
    }, delayMs);

    this.reminders.set(taskId, { timerId, fireAt, content, link });
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
  }

  // 触发通知
  _notify(taskId, content, link) {
    const safeLink = link ? this._sanitizeLink(link) : null;
    const body = safeLink ? `${content}\n${safeLink}` : content;

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const notification = new Notification('待办提醒', {
          body,
          icon: undefined
        });
        notification.onclick = () => {
          window.focus();
          if (safeLink) window.open(safeLink, '_blank');
          notification.close();
        };
        return;
      } catch (e) {
        // Notification 构造失败，fall through 到 Notice fallback
      }
    }
    new Notice(`⏰ 提醒: ${content}`, 10000);
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
