const { Plugin } = require('obsidian');
const path = require('path');
const { formatDate, formatDateTime } = require('./utils/date');
const TimerManager = require('./services/TimerManager');
const ErrorHandler = require('./services/ErrorHandler');
const TodoView = require('./views/TodoView');

class TodoKanbanPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.tasksData = { version: '1.2.0', tasks: [], lastModified: new Date().toISOString() };
    this.taskIdIndex = new Map(); // taskId -> { date, task }
    this.dateIndex = new Map();   // date -> dateTask
    this.timerManager = new TimerManager(); // 定时器管理器
    // 创建 ErrorHandler 实例，传入 Notice 类
    this.errorHandler = new ErrorHandler(require('obsidian').Notice);
  }

  // 构建索引
  buildIndexes() {
    this.taskIdIndex.clear();
    this.dateIndex.clear();

    for (const dateTask of this.tasksData.tasks) {
      this.dateIndex.set(dateTask.date, dateTask);
      for (const task of dateTask.tasksList) {
        this.taskIdIndex.set(task.taskId, { date: dateTask.date, task });
      }
    }
  }

  // 优化后的findTaskById使用索引查找
  findTaskById(taskId) {
    const indexed = this.taskIdIndex.get(taskId);
    return indexed ? indexed.task : null;
  }

  // 数据迁移函数
  migrateData(oldData) {
    // 检查是否有旧版本数据
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
    console.log('Loading Todo Kanban plugin...');
    
    // 使用 Obsidian Vault API 存储数据（路径相对于 vault 根目录）
    this.tasksFilePath = path.join(this.manifest.dir, 'tasks.json');
    
    console.log('Tasks file path:', this.tasksFilePath);
    
    // 加载任务数据
    await this.loadTasks();
    
    // 自动继承历史未完成任务到今天
    await this.inheritIncompleteTasks();
    
    // 设置凌晨1点的定时任务
    this.setupDailyInheritTimer();
    
    // 注册视图（使用唯一标识符避免冲突）
    this.registerView('todo-kanban-view', (leaf) => new TodoView(leaf, this, this.errorHandler));
    
    // 添加侧边栏图标
    this.addRibbonIcon('check-square', '待办看板', () => {
      this.activateView('todo-kanban-view');
    });
  }

  onunload() {
    console.log('Unloading Todo Kanban plugin...');
    // 使用定时器管理器清理所有定时器
    this.timerManager.clearAll();
    this.app.workspace.detachLeavesOfType('todo-kanban-view');
  }

  // 激活视图
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

  // 加载任务数据
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
      console.error('Failed to load tasks:', error);
      this.tasksData = { version: '1.2.0', tasks: [], lastModified: new Date().toISOString() };
      this.buildIndexes();
    }
  }

  // 保存任务数据（只在启动时备份，不每次操作都备份）
  async saveTasks() {
    try {
      // 更新最后修改时间
      this.tasksData.lastModified = new Date().toISOString();

      // 保存数据
      await this.app.vault.adapter.write(this.tasksFilePath, JSON.stringify(this.tasksData, null, 2));

      // 更新索引
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
    let hasChanges = false;
    
    // 查找或创建今天的任务组
    let todayTask = this.tasksData.tasks.find(t => t.date === todayStr);
    if (!todayTask) {
      todayTask = {
        date: todayStr,
        createTime: timeStr,
        tasksList: []
      };
      this.tasksData.tasks.push(todayTask);
    }
    
    // 获取今天已存在的任务ID（用于避免重复移动）
    const todayTaskIds = new Set(todayTask.tasksList.map(t => t.taskId));
    
    // 需要删除的空日期组
    const datesToRemove = [];
    
    // 遍历所有历史日期的任务
    for (const dateTask of this.tasksData.tasks) {
      // 跳过今天
      if (dateTask.date === todayStr) continue;
      
      // 查找未完成的任务
      const incompleteTasks = dateTask.tasksList.filter(task => !task.completed);
      
      // 移动未完成任务到今天
      for (const task of incompleteTasks) {
        // 检查是否已经移动过（避免重复）
        if (!todayTaskIds.has(task.taskId)) {
          // 移动任务（更新创建时间）
          task.createAt = timeStr;
          todayTask.tasksList.push(task);
          todayTaskIds.add(task.taskId);
          hasChanges = true;
        }
      }
      
      // 从历史日期中移除已移动的任务
      dateTask.tasksList = dateTask.tasksList.filter(task => task.completed);
      
      // 如果该日期没有任务了，标记删除
      if (dateTask.tasksList.length === 0) {
        datesToRemove.push(dateTask.date);
      }
    }
    
    // 删除空的日期组
    for (const date of datesToRemove) {
      const index = this.tasksData.tasks.findIndex(t => t.date === date);
      if (index !== -1) {
        this.tasksData.tasks.splice(index, 1);
      }
    }
    
    // 如果有变化，保存数据
    if (hasChanges) {
      await this.saveTasks();
      console.log('Moved incomplete tasks to today');
    }

    return hasChanges;
  }
  
  // 设置凌晨1点的定时任务（使用定时器管理器）
  setupDailyInheritTimer() {
    const now = new Date();
    const target = new Date(now);
    target.setHours(1, 0, 0, 0);

    // 如果当前时间已经过了今天凌晨1点，设置为明天凌晨1点
    if (now >= target) {
      target.setDate(target.getDate() + 1);
    }

    const delay = target.getTime() - now.getTime();

    console.log(`Next inherit scheduled at: ${target.toLocaleString()}`);

    this.timerManager.clearAll(); // 清理之前的定时器

    this.timerManager.setTimeout(async () => {
      console.log('Running scheduled inherit task at 1 AM');
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

  // 添加任务
  async addTask(date, task) {
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

  // 更新任务顺序
  async updateTasksOrder(date, newOrder) {
    const dateTask = this.tasksData.tasks.find(t => t.date === date);
    if (dateTask) {
      dateTask.tasksList = newOrder;
      await this.saveTasks();
    }
  }

  // 更新任务
  async updateTask(taskId, updatedTask) {
    for (const dateTask of this.tasksData.tasks) {
      const taskIndex = dateTask.tasksList.findIndex(t => t.taskId === taskId);
      if (taskIndex !== -1) {
        // 使用深拷贝创建新的任务对象，避免引用问题
        dateTask.tasksList[taskIndex] = JSON.parse(JSON.stringify(updatedTask));
        await this.saveTasks();
        return;
      }
    }
  }

  // 删除任务
  async deleteTask(taskId) {
    for (const dateTask of this.tasksData.tasks) {
      const taskIndex = dateTask.tasksList.findIndex(t => t.taskId === taskId);
      if (taskIndex !== -1) {
        dateTask.tasksList.splice(taskIndex, 1);
        
        // 如果该日期没有任务了，删除日期任务组
        if (dateTask.tasksList.length === 0) {
          const dateTaskIndex = this.tasksData.tasks.findIndex(t => t.date === dateTask.date);
          if (dateTaskIndex !== -1) {
            this.tasksData.tasks.splice(dateTaskIndex, 1);
          }
        }
        
        await this.saveTasks();
        return;
      }
    }
  }

  // 根据日期删除所有任务
  async deleteTasksByDate(date) {
    const dateTaskIndex = this.tasksData.tasks.findIndex(t => t.date === date);
    if (dateTaskIndex !== -1) {
      this.tasksData.tasks.splice(dateTaskIndex, 1);
      await this.saveTasks();
    }
  }

  // 移动任务到今天
  async moveTaskToToday(taskId) {
    const today = new Date();
    const todayStr = formatDate(today);
    const timeStr = formatDateTime(today);
    
    // 查找任务
    let taskToMove;
    let sourceDateTask;
    
    for (const dateTask of this.tasksData.tasks) {
      const taskIndex = dateTask.tasksList.findIndex(t => t.taskId === taskId);
      if (taskIndex !== -1) {
        taskToMove = dateTask.tasksList[taskIndex];
        sourceDateTask = dateTask;
        // 从原日期中移除任务
        dateTask.tasksList.splice(taskIndex, 1);
        
        // 如果该日期没有任务了，删除日期任务组
        if (dateTask.tasksList.length === 0) {
          const dateTaskIndex = this.tasksData.tasks.findIndex(t => t.date === dateTask.date);
          if (dateTaskIndex !== -1) {
            this.tasksData.tasks.splice(dateTaskIndex, 1);
          }
        }
        break;
      }
    }
    
    // 如果找到任务，添加到今天
    if (taskToMove) {
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
      
      // 保存数据
      await this.saveTasks();
    }
  }
}

module.exports = TodoKanbanPlugin;
