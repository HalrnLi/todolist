const { Notice } = require('obsidian');

class ReminderService {
  constructor(timerManager, app) {
    this.timerManager = timerManager;
    this.app = app;
    this.reminders = new Map(); // taskId -> { timerId, fireAt, content }
    this._requestPermission();
  }

  // 静默请求通知权限
  _requestPermission() {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // 设置提醒，返回 fireAt 时间戳
  setReminder(taskId, content, delayMs) {
    // 如果已有提醒，先取消
    this.cancelReminder(taskId);

    const fireAt = Date.now() + delayMs;
    const timerId = this.timerManager.setTimeout(() => {
      this._notify(taskId, content);
      this.reminders.delete(taskId);
      // 通知视图刷新闹钟图标
      this._notifyViewsToRefresh();
    }, delayMs);

    this.reminders.set(taskId, { timerId, fireAt, content });
    return fireAt;
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
  _notify(taskId, content) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const notification = new Notification('待办提醒', {
        body: content,
        icon: undefined
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } else {
      // fallback 到 Obsidian Notice
      new Notice(`⏰ 提醒: ${content}`, 10000);
    }
  }

  // 通知视图刷新
  _notifyViewsToRefresh() {
    const leaves = this.app.workspace.getLeavesOfType('todo-kanban-view');
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view && view.renderTasks) {
        view.renderTasks();
      }
    }
  }
}

module.exports = ReminderService;
