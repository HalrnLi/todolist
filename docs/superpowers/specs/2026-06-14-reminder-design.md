# 倒计时提醒功能设计

## 概述

为待办卡片添加右键菜单，支持设置倒计时提醒。到期后弹出系统级通知。

## 功能需求

- 右键待办卡片，弹出菜单，提供预设时间选项：10 分钟、30 分钟、1 小时、3 小时
- 支持自定义分钟数（1-1440，即最长 24 小时）
- 到期后通过浏览器 Notification API 弹出系统通知
- 已设置提醒的卡片显示闹钟图标，hover 显示剩余时间
- 支持取消已设置的提醒
- 仅当前会话有效，Obsidian 重启后提醒丢失
- 系统通知权限被拒绝时，fallback 到 Obsidian Notice

## 方案选择

使用 Obsidian 内置 `Menu` API 创建右键菜单，原生风格，自动适配主题，代码量最少。

## 交互设计

### 右键菜单结构

```
📋 提醒我
├── 10 分钟后
├── 30 分钟后
├── 1 小时后
├── 3 小时后
├── 自定义时间...
└── ─────────
    ⏰ 取消提醒 (剩余 XX 分钟)   ← 仅当已有提醒时显示
```

### 交互流程

1. 右键卡片 → 弹出 Menu
2. 选择预设时间 → 直接设置提醒，Notice 提示"已设置 XX 分钟后提醒"
3. 选择"自定义时间" → 弹出 PromptModal 输入分钟数 → 设置提醒
4. 选择"取消提醒" → 清除该任务的提醒，Notice 提示"已取消提醒"
5. 提醒到期 → 弹出系统通知"待办提醒"，内容为任务文本

### 自定义时间 PromptModal

- 标题："设置提醒时间"
- 输入框 placeholder："请输入分钟数（1-1440）"
- 验证：1-1440 之间的正整数，否则提示错误

## 架构设计

### 新增文件：services/ReminderService.js

提醒服务核心逻辑，管理所有活跃的提醒定时器。

**内存数据结构：**

```javascript
Map<taskId, {
  timerId: number,    // setTimeout 返回的 ID
  fireAt: number,     // 触发时间戳 (Date.now() + delay)
  content: string     // 任务内容，用于通知文案
}>
```

**核心方法：**

| 方法 | 说明 |
|------|------|
| `setReminder(taskId, content, delayMs)` | 设置提醒，返回 fireAt 时间戳 |
| `cancelReminder(taskId)` | 取消提醒，清除定时器 |
| `hasReminder(taskId)` | 查询是否有活跃提醒 |
| `getRemainingTime(taskId)` | 返回剩余毫秒数 |
| `clearAll()` | 清除所有提醒（插件卸载时调用） |

**通知逻辑：**

1. 通过 `TimerManager.setTimeout()` 注册定时器
2. 到期时检查 `Notification.permission`：
   - `granted` → `new Notification('待办提醒', { body: content })`
   - `denied` → fallback 到 `new Notice(content, 10000)`
3. 通知点击后 `app.focus()` 聚焦 Obsidian 窗口
4. 定时器到期后自动从 Map 中移除

**权限处理：**

- 插件加载时检查 `Notification.permission`
- 如果是 `default`，静默调用 `Notification.requestPermission()`
- 如果是 `denied`，在控制台 warn 并始终使用 Notice fallback

### 修改文件：views/TodoView.js

**右键菜单事件委托：**

在 `setupEventDelegation()` 中添加 `contextmenu` 事件监听：

```javascript
this.todoContainer.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.todo-card');
  if (!card) return;
  e.preventDefault();
  const taskId = card.dataset.taskId;
  this.showReminderMenu(e, taskId);
}, { signal: this.abortController.signal });
```

**showReminderMenu(e, taskId) 方法：**

使用 Obsidian `Menu` 构建菜单：

```javascript
showReminderMenu(e, taskId) {
  const menu = new Menu();
  const reminderService = this.plugin.reminderService;
  const task = this.plugin.findTaskById(taskId);

  // 预设选项
  const presets = [
    { label: '10 分钟后', ms: 10 * 60 * 1000 },
    { label: '30 分钟后', ms: 30 * 60 * 1000 },
    { label: '1 小时后', ms: 60 * 60 * 1000 },
    { label: '3 小时后', ms: 3 * 60 * 60 * 1000 },
  ];

  menu.addItem(item => item.setTitle('📋 提醒我').setDisabled(true));

  presets.forEach(preset => {
    menu.addItem(item => item
      .setTitle(preset.label)
      .onClick(() => {
        reminderService.setReminder(taskId, task.content, preset.ms);
        // 提示 + 刷新卡片图标
      })
    );
  });

  menu.addItem(item => item
    .setTitle('自定义时间...')
    .onClick(() => this.showCustomTimePrompt(taskId))
  );

  // 取消提醒（仅当已有提醒时）
  if (reminderService.hasReminder(taskId)) {
    menu.addSeparator();
    const remaining = reminderService.getRemainingTime(taskId);
    const mins = Math.ceil(remaining / 60000);
    menu.addItem(item => item
      .setTitle(`⏰ 取消提醒 (剩余 ${mins} 分钟)`)
      .onClick(() => {
        reminderService.cancelReminder(taskId);
        // 刷新卡片图标
      })
    );
  }

  menu.showAtPosition({ x: e.clientX, y: e.clientY });
}
```

**卡片渲染添加闹钟图标：**

在 `renderTask()` 方法中，`.todo-actions` 区域添加闹钟图标：

```javascript
// 在删除按钮之前
if (this.plugin.reminderService?.hasReminder(task.taskId)) {
  const alarmIcon = createEl('span', {
    cls: 'todo-reminder-icon',
    text: '⏰',
    attr: { 'data-task-id': task.taskId }
  });
  actionsDiv.appendChild(alarmIcon);
}
```

### 修改文件：plugin.js

**插件加载时：**

```javascript
this.reminderService = new ReminderService(this.timerManager, this.app);
```

**插件卸载时：**

```javascript
this.reminderService.clearAll();
```

**删除待办时自动取消提醒：**

在 `deleteTask()` 方法中，删除成功后调用 `this.reminderService.cancelReminder(taskId)` 清理对应提醒。

### 修改文件：styles.css

```css
.todo-reminder-icon {
  cursor: default;
  font-size: 12px;
  opacity: 0.7;
  margin-right: 4px;
}
```

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `services/ReminderService.js` | 提醒服务核心逻辑 |
| 修改 | `views/TodoView.js` | 右键菜单、卡片闹钟图标 |
| 修改 | `plugin.js` | 实例化和清理 ReminderService |
| 修改 | `styles.css` | 闹钟图标样式 |

**不改的文件：** models.js、TimerManager.js、modals/、tasks.json 数据结构、无数据迁移。

## 验收标准

1. 右键待办卡片，菜单正确显示 4 个预设选项 + 自定义时间
2. 选择预设时间后，卡片显示闹钟图标，Notice 提示已设置
3. 选择自定义时间，输入有效分钟数后设置成功
4. 输入无效值（0、负数、>1440、非数字）时提示错误
5. 到期后弹出系统通知，内容为任务文本
6. 系统通知被拒绝时 fallback 到 Obsidian Notice
7. 右键已有提醒的卡片，菜单显示"取消提醒"及剩余时间
8. 取消提醒后闹钟图标消失
9. 删除待办时自动取消对应提醒
10. Obsidian 重启后提醒不保留（符合预期）
