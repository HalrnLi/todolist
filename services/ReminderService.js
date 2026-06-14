const { Notice } = require('obsidian');

// 创建自定义通知弹窗（右上角弹出，支持多个同时显示，垂直堆叠）
function _showCustomNotification(content, safeLink) {
  const toast = document.createElement('div');
  toast.className = 'todo-toast';

  const icon = document.createElement('span');
  icon.textContent = '⏰';
  icon.className = 'todo-toast-icon';

  const text = document.createElement('span');
  text.textContent = content;
  text.className = 'todo-toast-text';

  const hint = document.createElement('span');
  hint.className = 'todo-toast-hint';
  hint.textContent = safeLink ? '点击打开链接' : '点击关闭';

  toast.appendChild(icon);
  toast.appendChild(text);
  toast.appendChild(hint);

  toast.addEventListener('click', () => {
    if (safeLink) window.open(safeLink, '_blank');
    toast.remove();
    // 容器空了就清理
    const container = document.querySelector('.todo-toast-container');
    if (container && !container.firstChild) container.remove();
  });

  // 确保有通知容器，新通知插在最前面
  let container = document.querySelector('.todo-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'todo-toast-container';
    document.body.appendChild(container);
  }
  container.insertBefore(toast, container.firstChild);
}

class ReminderService {
  constructor(timerManager, plugin) {
    this.timerManager = timerManager;
    this.plugin = plugin;
    this.reminders = new Map(); // taskId -> { timerId, fireAt, content, link }
    this._visibilityHandler = null;
    this._setupVisibilityFallback();
  }

  // 请求通知权限（Node/Electron 环境无需请求）
  async _requestPermission() {
    return 'granted';
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
    _showCustomNotification(content, safeLink);
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
