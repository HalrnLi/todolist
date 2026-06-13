const { Plugin } = require('obsidian');
const path = require('path');
const { formatDate, formatDateTime } = require('./utils/date');
const TimerManager = require('./services/TimerManager');
const ErrorHandler = require('./services/ErrorHandler');
const SecurityService = require('./services/SecurityService');
const ReminderService = require('./services/ReminderService');
const TodoView = require('./views/TodoView');

class TodoKanbanPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.tasksData = { version: '1.2.0', tasks: [], lastModified: new Date().toISOString() };
    this.taskIdIndex = new Map(); // taskId -> { date, task }
    this.dateIndex = new Map();   // date -> dateTask
    this.timerManager = new TimerManager();
    this.errorHandler = new ErrorHandler(require('obsidian').Notice);
    this.reminderService = null; // onload 中初始化
    this._dailyTimerId = null;
  }

  buildIndexes() {
    this.taskIdIndex.clear();
    this.dateIndex.clear();

    for (const dateTask of this.tasksData.tasks || []) {
      if (!dateTask || !Array.isArray(dateTask.tasksList) || !dateTask.date) continue;
      this.dateIndex.set(dateTask.date, dateTask);
      for (const task of dateTask.tasksList) {
        if (!task || !task.taskId) continue;
        this.taskIdIndex.set(task.taskId, { date: dateTask.date, task });
      }
    }
  }

  // 优化后的findTaskById使用索引查找
  findTaskById(taskId) {
    const indexed = this.taskIdIndex.get(taskId);
    return indexed ? indexed.task : null;
  }

  migrateData(oldData) {
    if (!oldData.version) {
      // 从旧版本迁移
      return {
        version: '1.2.0',
        tasks: oldData.tasks || [],
        lastModified: new Date().toISOString()
      };
    }

    // 版本 1.1.0 -> 1.2.0：添加 priority 字段支持
    if (oldData.version === '1.1.0') {
      // 为所有任务添加 priority 字段（如果不存在则设为 null）
      for (const dateTask of oldData.tasks) {
        for (const task of dateTask.tasksList) {
          if (!task.hasOwnProperty('priority')) {
            task.priority = null;
          }
        }
      }
      oldData.version = '1.2.0';
      oldData.lastModified = new Date().toISOString();
    }

    return oldData;
  }

  async onload() {
    this.tasksFilePath = path.join(this.manifest.dir, 'tasks.json');
    
    await this.loadTasks();

    this.reminderService = new ReminderService(this.timerManager, this);

    // 自动继承历史未完成任务到今天
    await this.inheritIncompleteTasks();
    
    this.setupDailyInheritTimer();
    
    // 注册视图（使用唯一标识符避免冲突）
    this.registerView('todo-kanban-view', (leaf) => new TodoView(leaf, this, this.errorHandler));
    
    // 添加侧边栏图标
    this.addRibbonIcon('check-square', '待办看板', () => {
      this.activateView('todo-kanban-view');
    });
  }

  onunload() {
    this.timerManager.clearAll();
    if (this.reminderService) {
      this.reminderService.clearAll();
    }
    this.app.workspace.detachLeavesOfType('todo-kanban-view');
  }

  async activateView(viewType) {
    let leaf;
    
    // 查找已存在的视图
    for (const l of this.app.workspace.getLeavesOfType(viewType)) {
      leaf = l;
      break;
    }
    
    // 如果不存在，创建新视图
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      await leaf.setViewState({
        type: viewType,
        active: true,
      });
    }
    
    // 激活视图
    this.app.workspace.revealLeaf(leaf);
  }

  async loadTasks() {
    try {
      const exists = await this.app.vault.adapter.exists(this.tasksFilePath);
      if (exists) {
        const data = await this.app.vault.adapter.read(this.tasksFilePath);
        let parsedData = JSON.parse(data);

        // 数据迁移
        parsedData = this.migrateData(parsedData);

        this.tasksData = parsedData;
      } else {
        this.tasksData = { version: '1.2.0', tasks: [], lastModified: new Date().toISOString() };
        await this.saveTasks();
      }

      // 构建索引
      this.buildIndexes();
    } catch (error) {
      this.errorHandler.handle(error, '加载任务数据');
      this.tasksData = { version: '1.2.0', tasks: [], lastModified: new Date().toISOString() };
      this.buildIndexes();
    }
  }

  async saveTasks() {
    try {
      this.tasksData.lastModified = new Date().toISOString();

      await this.app.vault.adapter.write(this.tasksFilePath, JSON.stringify(this.tasksData, null, 2));

      // 每次保存后重建索引，确保 dateIndex/taskIdIndex 与实际数据一致
      // （addTask 创建新日期组、deleteTask 删除空日期组都会直接修改 tasks 数组，需要同步索引）
      this.buildIndexes();
    } catch (error) {
      this.errorHandler.handle(error, '保存任务数据');
      throw error; // 重新抛出，让调用者处理
    }
  }

  // 启动时备份任务数据
  async backupTasks() {
    try {
      const backupPath = this.tasksFilePath.replace('.json', '-backup.json');
      await this.app.vault.adapter.write(backupPath, JSON.stringify(this.tasksData, null, 2));
    } catch (error) {
      console.error('Backup failed:', error);
    }
  }

  // 自动继承历史未完成任务到今天（移动而非复制）
  // 返回是否有变化
  async inheritIncompleteTasks() {
    const today = new Date();
    const todayStr = formatDate(today);
    const timeStr = formatDateTime(today);

    const existingTodayTask = this.tasksData.tasks.find(t => t.date === todayStr);
    const existingTodayTasks = existingTodayTask ? [...existingTodayTask.tasksList] : [];
    const todayTaskIds = new Set(existingTodayTasks.map(t => t.taskId));
    const movedTasks = [];

    // 收集历史未完成任务（不可变操作）
    const remainingHistory = [];
    for (const dateTask of this.tasksData.tasks) {
      if (dateTask.date === todayStr) continue;

      const completedTasks = dateTask.tasksList.filter(task => task.completed);
      const incompleteTasks = dateTask.tasksList.filter(task => !task.completed);

      for (const task of incompleteTasks) {
        if (!todayTaskIds.has(task.taskId)) {
          movedTasks.push({ ...task, createAt: timeStr });
        }
      }

      if (completedTasks.length > 0) {
        remainingHistory.push({ ...dateTask, tasksList: completedTasks });
      }
    }

    const hasChanges = movedTasks.length > 0;
    if (!hasChanges) return false;

    const newTodayTask = {
      date: todayStr,
      createTime: existingTodayTask ? existingTodayTask.createTime : timeStr,
      tasksList: [...existingTodayTasks, ...movedTasks]
    };

    const newTasksData = {
      ...this.tasksData,
      tasks: [newTodayTask, ...remainingHistory]
    };

    // 原子更新：先保存旧数据引用，赋值后保存，失败则回滚
    const oldTasksData = this.tasksData;
    this.tasksData = newTasksData;
    try {
      await this.saveTasks();
    } catch (error) {
      this.tasksData = oldTasksData;
      this.buildIndexes();
      throw error;
    }

    return true;
  }
  
  setupDailyInheritTimer() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(1, 0, 0, 0);

    if (now >= target) {
      target.setDate(target.getDate() + 1);
    }

    const delay = target.getTime() - now.getTime();

    // 只清除上一次的每日定时器，不影响提醒定时器
    if (this._dailyTimerId != null) {
      clearTimeout(this._dailyTimerId);
    }

    this._dailyTimerId = this.timerManager.setTimeout(async () => {
      const hasChanges = await this.inheritIncompleteTasks();
      // 如果有变化，通知所有视图刷新
      if (hasChanges) {
        this.notifyViewsToRefresh();
      }
      // 重新设置下一次定时任务
      this.setupDailyInheritTimer();
    }, delay);
  }

  // 通知所有待办视图刷新
  notifyViewsToRefresh() {
    const leaves = this.app.workspace.getLeavesOfType('todo-kanban-view');
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view && view.renderTasks) {
        view.renderTasks();
      }
    }
  }

  async addTask(date, task) {
    SecurityService.validateTaskContent(task.content);

    // 查找该日期的任务组
    let dateTask = this.tasksData.tasks.find(t => t.date === date);

    // 如果不存在，创建新的日期任务组
    if (!dateTask) {
      dateTask = {
        date,
        createTime: task.createAt,
        tasksList: []
      };
      this.tasksData.tasks.push(dateTask);
    }

    // 添加任务
    dateTask.tasksList.push(task);

    // 保存数据
    await this.saveTasks();
  }

  // 根据日期获取任务
  getTasksByDate(date) {
    return this.tasksData.tasks.find(t => t.date === date);
  }

  async updateTasksOrder(date, newOrder) {
    const dateTask = this.tasksData.tasks.find(t => t.date === date);
    if (dateTask) {
      dateTask.tasksList = newOrder;
      await this.saveTasks();
    }
  }

  async updateTask(taskId, updatedTask) {
    const indexed = this.taskIdIndex.get(taskId);
    if (!indexed) return;

    const { date } = indexed;
    const dateTask = this.dateIndex.get(date);
    if (!dateTask) return;

    const taskIndex = dateTask.tasksList.findIndex(t => t.taskId === taskId);
    if (taskIndex === -1) return;

    // 校验任务内容
    SecurityService.validateTaskContent(updatedTask.content);

    // 消毒链接
    const safeLink = SecurityService.sanitizeLink(updatedTask.link);

    // 校验优先级
    const validPriorities = ['high', 'medium', 'low', null, undefined];
    if (!validPriorities.includes(updatedTask.priority)) {
      throw new Error(`无效的优先级: ${updatedTask.priority}`);
    }

    // 校验截止日期格式
    if (updatedTask.dueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(updatedTask.dueDate)) {
      throw new Error(`无效的截止日期格式: ${updatedTask.dueDate}`);
    }

    // 防御性复制：只复制自有属性，避免原型污染
    dateTask.tasksList[taskIndex] = {
      taskId: updatedTask.taskId,
      content: updatedTask.content,
      completed: updatedTask.completed,
      createAt: updatedTask.createAt,
      link: safeLink,
      dueDate: updatedTask.dueDate,
      priority: updatedTask.priority
    };
    await this.saveTasks();
  }

  async deleteTask(taskId) {
    const indexed = this.taskIdIndex.get(taskId);
    if (!indexed) return;

    const { date } = indexed;
    const dateTask = this.dateIndex.get(date);
    if (!dateTask) return;

    const taskIndex = dateTask.tasksList.findIndex(t => t.taskId === taskId);
    if (taskIndex === -1) return;

    dateTask.tasksList.splice(taskIndex, 1);

    // 取消该任务的提醒
    if (this.reminderService) {
      this.reminderService.cancelReminder(taskId);
    }

    // 如果该日期没有任务了，删除日期任务组
    if (dateTask.tasksList.length === 0) {
      const dateTaskIndex = this.tasksData.tasks.findIndex(t => t.date === dateTask.date);
      if (dateTaskIndex !== -1) {
        this.tasksData.tasks.splice(dateTaskIndex, 1);
      }
    }

    await this.saveTasks();
  }

  // 根据日期删除所有任务
  async deleteTasksByDate(date) {
    const dateTaskIndex = this.tasksData.tasks.findIndex(t => t.date === date);
    if (dateTaskIndex !== -1) {
      const dateTask = this.tasksData.tasks[dateTaskIndex];
      if (this.reminderService) {
        for (const task of dateTask.tasksList) {
          this.reminderService.cancelReminder(task.taskId);
        }
      }
      this.tasksData.tasks.splice(dateTaskIndex, 1);
      await this.saveTasks();
    }
  }

  // 移动任务到今天（使用索引优化查找）
  async moveTaskToToday(taskId) {
    const today = new Date();
    const todayStr = formatDate(today);
    const timeStr = formatDateTime(today);

    const indexed = this.taskIdIndex.get(taskId);
    if (!indexed) return;

    const { date: sourceDate } = indexed;
    const sourceDateTask = this.dateIndex.get(sourceDate);
    if (!sourceDateTask) return;

    const taskIndex = sourceDateTask.tasksList.findIndex(t => t.taskId === taskId);
    if (taskIndex === -1) return;

    const [taskToMove] = sourceDateTask.tasksList.splice(taskIndex, 1);

    // 如果该日期没有任务了，删除日期任务组
    if (sourceDateTask.tasksList.length === 0) {
      const dateTaskIndex = this.tasksData.tasks.findIndex(t => t.date === sourceDateTask.date);
      if (dateTaskIndex !== -1) {
        this.tasksData.tasks.splice(dateTaskIndex, 1);
      }
    }

    // 查找今天的任务组
    let todayTask = this.tasksData.tasks.find(t => t.date === todayStr);

    // 如果不存在，创建新的日期任务组
    if (!todayTask) {
      todayTask = {
        date: todayStr,
        createTime: timeStr,
        tasksList: []
      };
      this.tasksData.tasks.push(todayTask);
    }

    // 添加任务到今天（保留原始创建时间）
    todayTask.tasksList.push(taskToMove);

    await this.saveTasks();
  }
}

module.exports = TodoKanbanPlugin;
