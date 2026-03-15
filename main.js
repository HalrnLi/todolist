const { App, Plugin, WorkspaceLeaf, ItemView, Modal } = require('obsidian');
const fs = require('fs');
const path = require('path');

// 生成唯一ID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 安全服务类 - XSS防护和输入验证
class SecurityService {
  static sanitizeInput(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  static validateTaskContent(content) {
    if (!content || typeof content !== 'string') {
      throw new Error('任务内容不能为空');
    }

    // 限制长度
    if (content.length > 1000) {
      throw new Error('任务内容不能超过1000个字符');
    }

    // 禁止HTML标签（防止XSS）
    if (/<[^>]*>/.test(content)) {
      throw new Error('任务内容不能包含HTML标签');
    }

    return content.trim();
  }

  static sanitizeLink(link) {
    if (!link || typeof link !== 'string') return '';

    // 只允许http/https协议
    try {
      const url = new URL(link);
      return url.protocol === 'http:' || url.protocol === 'https:' ? link : '';
    } catch {
      return '';
    }
  }
}

// 错误处理类
class ErrorHandler {
  static handle(error, context = '未知错误') {
    console.error(`[${context}]`, error);

    // 显示用户友好的错误提示
    if (typeof window !== 'undefined' && window.obsidian) {
      const notice = new window.obsidian.Notice(`操作失败: ${error.message}`, 5000);
      notice.show();
    }
  }
}

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

// 格式化日期为 YYYY-MM-DD（使用本地时间，避免时区问题）
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 格式化时间为 YYYY-MM-DD HH:MM
function formatDateTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// 获取某周的开始日期（周一）
function getWeekStartDate(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

// 获取某周的结束日期（周日）
function getWeekEndDate(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? 0 : 7);
  return new Date(d.setDate(diff));
}

// 格式化周为 YYYY-MM-DD ~ YYYY-MM-DD
function formatWeek(date) {
  const start = getWeekStartDate(date);
  const end = getWeekEndDate(date);
  return `${formatDate(start)} ~ ${formatDate(end)}`;
}

// 任务优先级定义
const PRIORITY = {
  HIGH: { value: 'high', label: '高', order: 0, color: '#ff5555' },
  MEDIUM: { value: 'medium', label: '中', order: 1, color: '#ffaa00' },
  LOW: { value: 'low', label: '低', order: 2, color: '#55aa55' },
  NONE: { value: 'none', label: '无', order: 3, color: null }
};

// 获取优先级配置
function getPriorityConfig(priorityValue) {
  return Object.values(PRIORITY).find(p => p.value === priorityValue) || PRIORITY.NONE;
}

// 解析任务内容中的标签 (#tag)
function parseTags(content) {
  if (!content || typeof content !== 'string') return [];
  const tagRegex = /#([\w\u4e00-\u9fa5\-_]+)/g;
  const tags = [];
  let match;
  while ((match = tagRegex.exec(content)) !== null) {
    tags.push(match[1]);
  }
  return [...new Set(tags)]; // 去重
}

// 移除内容中的标签标记，返回纯文本
function removeTags(content) {
  if (!content || typeof content !== 'string') return content;
  return content.replace(/#[\w\u4e00-\u9fa5\-_]+/g, '').replace(/\s+/g, ' ').trim();
}

// 判断任务是否为紧急置顶任务（截止日期前一天开始置顶）
function isUrgentTask(task, todayStr) {
  if (!task.dueDate || task.completed) return false;
  const today = new Date(todayStr);
  const dueDate = new Date(task.dueDate);
  const oneDayBeforeDue = new Date(dueDate);
  oneDayBeforeDue.setDate(oneDayBeforeDue.getDate() - 1);
  oneDayBeforeDue.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return today >= oneDayBeforeDue;
}

// 待办视图
class TodoView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    // 用于清理事件监听器的 AbortController
    this.abortController = new AbortController();
    this.signal = this.abortController.signal;
  }

  getViewType() {
    return 'todo-kanban-view';
  }

  getDisplayText() {
    return '待办看板';
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('todo-view-container');
    
    // 确保父容器也有正确的高度
    this.containerEl.style.height = '100%';
    if (this.containerEl.parentElement) {
      this.containerEl.parentElement.style.height = '100%';
    }
    
    container.style.height = '100%';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.overflow = 'hidden';
    
    // 创建筛选器
    const filterSection = container.createEl('div', { cls: 'todo-filter-section' });
    filterSection.style.flexShrink = '0';
    filterSection.createEl('label', { text: '查看范围：', cls: 'todo-filter-label' });
    this.filterSelect = filterSection.createEl('select', { cls: 'todo-filter-select' });
    this.filterSelect.add(new Option('当日待办', 'today'));
    this.filterSelect.add(new Option('近7天', '7days'));
    this.filterSelect.add(new Option('近30天', '30days'));
    this.filterSelect.add(new Option('本周', 'week'));
    this.filterSelect.add(new Option('全部日期', 'all'));
    this.filterSelect.addEventListener('change', () => this.renderTasks(), { signal: this.signal });
    
    // 搜索框
    this.searchInput = filterSection.createEl('input', {
      type: 'text',
      placeholder: '搜索待办...',
      cls: 'todo-search-input'
    });
    this.searchInput.addEventListener('input', () => this.renderTasks(), { signal: this.signal });
    
    // 导出按钮
    const exportBtn = filterSection.createEl('button', {
      text: '导出Excel',
      cls: 'todo-export-button'
    });
    exportBtn.addEventListener('click', () => this.showExportDialog(), { signal: this.signal });

    // 标签筛选区域（初始隐藏）
    this.tagFilterSection = container.createEl('div', { cls: 'todo-tag-filter-section' });
    this.tagFilterSection.style.display = 'none';
    this.tagFilterSection.createEl('label', { text: '标签筛选：', cls: 'todo-filter-label' });
    this.tagFilterBadge = this.tagFilterSection.createEl('span', { cls: 'todo-tag-filter-badge' });
    const clearTagBtn = this.tagFilterSection.createEl('button', {
      text: '清除',
      cls: 'todo-clear-tag-btn'
    });
    clearTagBtn.addEventListener('click', () => this.clearTagFilter(), { signal: this.signal });

    // 优先级筛选区域
    const priorityFilterSection = container.createEl('div', { cls: 'todo-priority-filter-section' });
    priorityFilterSection.createEl('label', { text: '优先级：', cls: 'todo-filter-label' });
    this.priorityFilterSelect = priorityFilterSection.createEl('select', { cls: 'todo-filter-select' });
    this.priorityFilterSelect.add(new Option('全部', 'all'));
    this.priorityFilterSelect.add(new Option('高', 'high'));
    this.priorityFilterSelect.add(new Option('中', 'medium'));
    this.priorityFilterSelect.add(new Option('低', 'low'));
    this.priorityFilterSelect.add(new Option('无', 'none'));
    this.priorityFilterSelect.addEventListener('change', () => this.renderTasks(), { signal: this.signal });

    // 创建任务容器
    this.todoContainer = container.createEl('div', { cls: 'todo-container' });
    this.todoContainer.style.flex = '1 1 0';
    this.todoContainer.style.minHeight = '0';
    this.todoContainer.style.overflowY = 'auto';
    this.todoContainer.style.overflowX = 'hidden';
    
    // 创建输入区域（放在底部）
    const inputSection = container.createEl('div', { cls: 'todo-input-section' });
    inputSection.style.flexShrink = '0';
    
    // 任务内容输入
    this.taskInput = inputSection.createEl('textarea', {
      placeholder: '输入任务内容，按 Enter 键添加（Shift+Enter 换行）',
      cls: 'todo-input'
    });
    
    // 链接输入（可选）
    const linkRow = inputSection.createEl('div', { cls: 'todo-input-row' });
    linkRow.createEl('label', { text: '链接（可选）：', cls: 'todo-input-label' });
    this.taskLink = linkRow.createEl('input', {
      type: 'text',
      placeholder: 'https://...',
      cls: 'todo-link-input'
    });
    
    // 截止日期输入（可选）
    const dateRow = inputSection.createEl('div', { cls: 'todo-input-row' });
    dateRow.style.cursor = 'pointer';
    dateRow.createEl('label', { text: '截止日期（可选）：', cls: 'todo-input-label' });
    this.taskDueDate = dateRow.createEl('input', {
      type: 'date',
      cls: 'todo-date-input'
    });
    // 点击整行触发日期选择器
    dateRow.addEventListener('click', (e) => {
      if (e.target !== this.taskDueDate) {
        e.stopPropagation();
        setTimeout(() => {
          this.taskDueDate.focus();
          this.taskDueDate.click();
        }, 0);
      }
    }, { signal: this.signal });

    // 优先级选择（可选）
    const priorityRow = inputSection.createEl('div', { cls: 'todo-input-row' });
    priorityRow.createEl('label', { text: '优先级（可选）：', cls: 'todo-input-label' });
    this.taskPriority = priorityRow.createEl('select', { cls: 'todo-priority-select' });
    this.taskPriority.add(new Option('无', 'none'));
    this.taskPriority.add(new Option('高', 'high'));
    this.taskPriority.add(new Option('中', 'medium'));
    this.taskPriority.add(new Option('低', 'low'));

    // 按钮容器
    const buttonContainer = inputSection.createEl('div', { cls: 'todo-input-buttons' });
    buttonContainer.createEl('button', {
      text: '添加',
      cls: 'todo-add-button'
    }).addEventListener('click', () => this.addTasks(), { signal: this.signal });
    
    buttonContainer.createEl('button', {
      text: '清空',
      cls: 'todo-clear-button'
    }).addEventListener('click', () => {
      this.taskInput.value = '';
      this.taskLink.value = '';
      this.taskDueDate.value = '';
    }, { signal: this.signal });
    
    // 回车添加任务，Shift+Enter 换行
    this.taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.addTasks();
      }
    }, { signal: this.signal });
    
    // 自动调整输入框高度
    this.taskInput.addEventListener('input', () => {
      this.taskInput.style.height = 'auto';
      this.taskInput.style.height = Math.min(this.taskInput.scrollHeight, 200) + 'px';
    }, { signal: this.signal });

    // 设置事件委托（优化性能）
    this.setupEventDelegation(this.signal);

    // 渲染任务
    this.renderTasks();
  }

  // 设置事件委托（减少事件监听器数量）
  setupEventDelegation(signal) {
    // 委托容器处理所有卡片事件（仅处理点击事件，拖拽事件由 createTaskCard 单独处理以确保不跨日期组）
    this.todoContainer.addEventListener('click', (e) => {
      const card = e.target.closest('.todo-card');
      if (!card) return;

      // 处理复选框
      if (e.target.type === 'checkbox') {
        this.handleTaskComplete(card.dataset.taskId, e.target.checked);
      }

      // 处理删除按钮
      if (e.target.classList.contains('todo-delete-button')) {
        this.handleTaskDelete(card.dataset.taskId);
      }
    }, { signal });

    // 注：拖拽排序事件由 createTaskCard 中的事件处理程序管理
    // 这样可以确保拖拽只能在同一日期组内进行，避免跨日期移动任务
  }

  // 处理任务完成状态变化
  async handleTaskComplete(taskId, completed) {
    const task = this.plugin.findTaskById(taskId);
    if (task) {
      task.completed = completed;
      await this.plugin.updateTask(taskId, task);
      this.renderTasks();
    }
  }

  // 处理任务删除
  async handleTaskDelete(taskId) {
    await this.plugin.deleteTask(taskId);
    this.renderTasks();
  }

  async onClose() {
    // 视图关闭时的清理工作
    // 使用 AbortController 清理所有事件监听器
    this.abortController.abort();
  }

  // 添加任务（带输入验证）
  async addTasks() {
    const inputText = this.taskInput.value.trim();
    if (!inputText) return;

    const tasks = inputText.split('\n').filter(task => task.trim());
    const today = new Date();
    const dateStr = formatDate(today);
    const timeStr = formatDateTime(today);

    // 获取链接、截止日期和优先级
    const link = this.taskLink.value.trim() || null;
    const dueDate = this.taskDueDate.value || null;
    const priority = this.taskPriority.value !== 'none' ? this.taskPriority.value : null;

    // 安全处理链接
    const safeLink = SecurityService.sanitizeLink(link);

    for (const taskContent of tasks) {
      try {
        // 验证和消毒任务内容
        const validatedContent = SecurityService.validateTaskContent(taskContent);

        const newTask = {
          taskId: generateUUID(),
          content: validatedContent,
          completed: false,
          createAt: timeStr,
          link: safeLink,
          dueDate: dueDate,
          priority: priority
        };

        await this.plugin.addTask(dateStr, newTask);
      } catch (error) {
        ErrorHandler.handle(error, '添加任务');
        return; // 如果有验证失败，停止添加所有任务
      }
    }

    this.taskInput.value = '';
    this.taskLink.value = '';
    this.taskDueDate.value = '';
    this.taskPriority.value = 'none';
    this.renderTasks();
  }

  // 优化后的渲染任务（使用DocumentFragment和分批渲染）
  renderTasks() {
    const filter = this.filterSelect.value;
    const today = new Date();
    const todayStr = formatDate(today);

    // 过滤任务
    let filteredTasks = [...this.plugin.tasksData.tasks];

    if (filter === 'today') {
      filteredTasks = filteredTasks.filter(task => task.date === todayStr);
    } else if (filter === '7days') {
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      filteredTasks = filteredTasks.filter(task => {
        const taskDate = new Date(task.date);
        return taskDate >= sevenDaysAgo && taskDate <= today;
      });
    } else if (filter === '30days') {
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filteredTasks = filteredTasks.filter(task => {
        const taskDate = new Date(task.date);
        return taskDate >= thirtyDaysAgo && taskDate <= today;
      });
    } else if (filter === 'week') {
      const weekStart = getWeekStartDate(today);
      const weekEnd = getWeekEndDate(today);
      filteredTasks = filteredTasks.filter(task => {
        const taskDate = new Date(task.date);
        return taskDate >= weekStart && taskDate <= weekEnd;
      });
    }

    // 搜索过滤
    const searchKeyword = this.searchInput.value.trim().toLowerCase();
    if (searchKeyword) {
      filteredTasks = filteredTasks.map(dateTask => {
        const filteredTasksList = dateTask.tasksList.filter(task => {
          const contentMatch = task.content.toLowerCase().includes(searchKeyword);
          const linkMatch = task.link && task.link.toLowerCase().includes(searchKeyword);
          const dueDateMatch = task.dueDate && task.dueDate.includes(searchKeyword);
          return contentMatch || linkMatch || dueDateMatch;
        });
        return {
          ...dateTask,
          tasksList: filteredTasksList
        };
      }).filter(dateTask => dateTask.tasksList.length > 0);
    }

    // 标签筛选
    if (this.currentTagFilter) {
      filteredTasks = filteredTasks.map(dateTask => {
        const filteredTasksList = dateTask.tasksList.filter(task => {
          const tags = parseTags(task.content);
          return tags.includes(this.currentTagFilter);
        });
        return {
          ...dateTask,
          tasksList: filteredTasksList
        };
      }).filter(dateTask => dateTask.tasksList.length > 0);
    }

    // 优先级筛选
    const priorityFilter = this.priorityFilterSelect?.value;
    if (priorityFilter && priorityFilter !== 'all') {
      filteredTasks = filteredTasks.map(dateTask => {
        const filteredTasksList = dateTask.tasksList.filter(task => {
          if (priorityFilter === 'none') {
            return !task.priority;
          }
          return task.priority === priorityFilter;
        });
        return {
          ...dateTask,
          tasksList: filteredTasksList
        };
      }).filter(dateTask => dateTask.tasksList.length > 0);
    }

    // 按日期倒序排序（今天在上面，历史在下面）
    filteredTasks.sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    // 使用DocumentFragment减少重排
    const fragment = document.createDocumentFragment();

    if (filteredTasks.length === 0) {
      const emptyEl = document.createElement('p');
      emptyEl.textContent = '没有任务，添加一个吧！';
      emptyEl.className = 'todo-empty';
      fragment.appendChild(emptyEl);
      this.todoContainer.empty();
      this.todoContainer.appendChild(fragment);
      return;
    }

    // 分批渲染，避免阻塞主线程
    this.renderTasksInBatches(filteredTasks, fragment, todayStr).then(() => {
      this.todoContainer.empty();
      this.todoContainer.appendChild(fragment);
    });
  }

  // 分批渲染任务
  async renderTasksInBatches(filteredTasks, fragment, todayStr) {
    const batchSize = 20;
    const totalBatches = Math.ceil(filteredTasks.length / batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, filteredTasks.length);
      const batch = filteredTasks.slice(start, end);

      // 渲染当前批次
      for (const dateTask of batch) {
        const dateSection = document.createElement('div');
        dateSection.className = 'todo-date-section';

        // 日期标题
        const dateHeader = document.createElement('div');
        dateHeader.className = 'todo-date-header';
        const dateTitle = document.createElement('h3');
        dateTitle.textContent = dateTask.date === todayStr ? `${dateTask.date} (今天)` : dateTask.date;
        dateTitle.className = 'todo-date-title';
        dateHeader.appendChild(dateTitle);

        // 清空按钮
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '清空';
        clearBtn.className = 'todo-clear-date-button';
        clearBtn.addEventListener('click', async () => {
          if (confirm(`确定要清空 ${dateTask.date} 的所有任务吗？`)) {
            await this.plugin.deleteTasksByDate(dateTask.date);
            this.renderTasks();
          }
        }, { signal: this.signal });
        dateHeader.appendChild(clearBtn);
        dateSection.appendChild(dateHeader);

        // 任务列表容器
        const tasksContainer = document.createElement('div');
        tasksContainer.className = 'todo-date-tasks';

        // 状态筛选器
        const statusFilter = document.createElement('div');
        statusFilter.className = 'todo-status-filter';

        const incompleteBtn = document.createElement('button');
        incompleteBtn.textContent = '未完成';
        incompleteBtn.className = 'todo-status-button todo-status-active';
        incompleteBtn.addEventListener('click', (e) => {
          this.updateStatusFilter(e.target, tasksContainer, 'incomplete');
        }, { signal: this.signal });
        statusFilter.appendChild(incompleteBtn);

        const completedBtn = document.createElement('button');
        completedBtn.textContent = '已完成';
        completedBtn.className = 'todo-status-button';
        completedBtn.addEventListener('click', (e) => {
          this.updateStatusFilter(e.target, tasksContainer, 'completed');
        }, { signal: this.signal });
        statusFilter.appendChild(completedBtn);
        tasksContainer.appendChild(statusFilter);

        // 任务列表
        const tasksList = document.createElement('div');
        tasksList.className = 'todo-tasks-list';

        // 排序逻辑：紧急任务 > 优先级 > 截止时间
        const sortedTasks = [...dateTask.tasksList].sort((a, b) => {
          const aIsUrgent = isUrgentTask(a, todayStr);
          const bIsUrgent = isUrgentTask(b, todayStr);

          // 紧急任务置顶
          if (aIsUrgent && !bIsUrgent) return -1;
          if (!aIsUrgent && bIsUrgent) return 1;

          // 优先级排序（高优先级在前）
          const aPriority = getPriorityConfig(a.priority).order;
          const bPriority = getPriorityConfig(b.priority).order;
          if (aPriority !== bPriority) {
            return aPriority - bPriority;
          }

          // 如果a没有截止时间，a排在前面
          if (!a.dueDate && b.dueDate) return -1;
          // 如果b没有截止时间，b排在前面
          if (a.dueDate && !b.dueDate) return 1;
          // 如果都没有截止时间，保持原顺序
          if (!a.dueDate && !b.dueDate) return 0;
          // 如果都有截止时间，按时间从近到远排序
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        });

        // 渲染任务卡片
        for (const task of sortedTasks) {
          this.createTaskCard(tasksList, task, dateTask.date);
        }

        tasksContainer.appendChild(tasksList);
        dateSection.appendChild(tasksContainer);
        fragment.appendChild(dateSection);

        // 默认筛选未完成
        this.updateStatusFilter(incompleteBtn, tasksContainer, 'incomplete');
      }

      // 每批渲染后让出控制权，避免阻塞主线程
      if (batchIndex < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }

  // 更新状态筛选
  updateStatusFilter(button, container, status) {
    // 更新按钮状态
    container.querySelectorAll('.todo-status-button').forEach(btn => {
      btn.classList.remove('todo-status-active');
    });
    button.classList.add('todo-status-active');
    
    // 筛选任务（从 DOM 元素的 dataset 中获取状态）
    const tasksList = container.querySelector('.todo-tasks-list');
    const taskCards = tasksList.querySelectorAll('.todo-card');
    
    taskCards.forEach(card => {
      const isCompleted = card.dataset.completed === 'true';
      if (status === 'all') {
        card.style.display = 'flex';
      } else if (status === 'incomplete' && !isCompleted) {
        card.style.display = 'flex';
      } else if (status === 'completed' && isCompleted) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  }

  // 设置标签筛选
  setTagFilter(tag) {
    this.currentTagFilter = tag;
    if (this.tagFilterSection) {
      this.tagFilterSection.style.display = 'flex';
      this.tagFilterBadge.textContent = `#${tag}`;
    }
    this.renderTasks();
  }

  // 清除标签筛选
  clearTagFilter() {
    this.currentTagFilter = null;
    if (this.tagFilterSection) {
      this.tagFilterSection.style.display = 'none';
    }
    this.renderTasks();
  }

  // 显示编辑对话框
  showEditDialog(task, card) {
    const modal = new EditModal(this.app, this, task, card);
    modal.open();
  }

  // 更新任务卡片显示
  updateTaskCard(card, task) {
    const content = card.querySelector('.todo-content');
    const textEl = content.querySelector('.todo-text');
    const dueDateEl = content.querySelector('.todo-due-date');
    const linkEl = content.querySelector('.todo-link');
    
    // 更新文本
    textEl.textContent = task.content;
    
    // 更新截止日期
    if (task.dueDate) {
      if (dueDateEl) {
        dueDateEl.textContent = `截止: ${task.dueDate}`;
      } else {
        const newDueDate = content.createEl('p', { 
          text: `截止: ${task.dueDate}`, 
          cls: 'todo-due-date' 
        });
        // 插入到链接之前
        if (linkEl) {
          content.insertBefore(newDueDate, linkEl);
        }
      }
    } else if (dueDateEl) {
      dueDateEl.remove();
    }
    
    // 更新链接
    if (task.link) {
      if (linkEl) {
        linkEl.href = task.link;
      } else {
        content.createEl('a', { 
          text: '打开链接',
          cls: 'todo-link',
          href: task.link,
          target: '_blank'
        });
      }
    } else if (linkEl) {
      linkEl.remove();
    }
  }

  // 显示导出对话框
  showExportDialog() {
    const modal = new ExportModal(this.app, this);
    modal.open();
  }

  // 导出任务到CSV
  async exportTasksToCSV(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // 过滤日期范围内的任务
    const filteredTasks = [];
    for (const dateTask of this.plugin.tasksData.tasks) {
      const taskDate = new Date(dateTask.date);
      if (taskDate >= start && taskDate <= end) {
        for (const task of dateTask.tasksList) {
          filteredTasks.push({
            date: dateTask.date,
            content: task.content,
            completed: task.completed ? '已完成' : '未完成',
            dueDate: task.dueDate || '',
            link: task.link || '',
            createAt: task.createAt
          });
        }
      }
    }
    
    if (filteredTasks.length === 0) {
      alert('所选日期范围内没有任务');
      return;
    }
    
    // 生成CSV内容
    const headers = ['日期', '任务内容', '状态', '截止日期', '链接', '创建时间'];
    const csvRows = [headers.join(',')];
    
    for (const task of filteredTasks) {
      const row = [
        task.date,
        `"${task.content.replace(/"/g, '""')}"`,
        task.completed,
        task.dueDate,
        task.link,
        task.createAt
      ];
      csvRows.push(row.join(','));
    }
    
    const csvContent = '\uFEFF' + csvRows.join('\n'); // 添加BOM以支持中文
    
    // 创建下载链接
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `待办导出_${startDate}_${endDate}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // 创建任务卡片
  createTaskCard(container, task, taskDate) {
    const todayStr = formatDate(new Date());
    const isUrgent = isUrgentTask(task, todayStr);
    
    const card = container.createEl('div', {
      cls: `todo-card ${task.completed ? 'todo-card-completed' : ''} ${isUrgent ? 'todo-card-urgent' : ''}`
    });
    
    card.draggable = true;
    card.dataset.taskId = task.taskId;
    card.dataset.completed = task.completed.toString();
    card.dataset.date = taskDate;
    
    card.addEventListener('dragstart', (e) => {
      card.classList.add('todo-card-dragging');
      e.dataTransfer.setData('text/plain', task.taskId);
      e.dataTransfer.effectAllowed = 'move';
    }, { signal: this.signal });
    
    card.addEventListener('dragend', () => {
      card.classList.remove('todo-card-dragging');
    }, { signal: this.signal });
    
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const draggingCard = container.querySelector('.todo-card-dragging');
      if (draggingCard && draggingCard !== card) {
        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          container.insertBefore(draggingCard, card);
        } else {
          container.insertBefore(draggingCard, card.nextSibling);
        }
      }
    }, { signal: this.signal });
    
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      await this.saveTasksOrder(container, taskDate);
    }, { signal: this.signal });
    
    const checkbox = card.createEl('input', {
      type: 'checkbox',
      checked: task.completed,
      cls: 'todo-checkbox'
    });
    
    const content = card.createEl('div', {
      cls: 'todo-content'
    });
    
    // 紧急标识
    if (isUrgent) {
      content.createEl('span', { text: '🔴 紧急', cls: 'todo-urgent-badge' });
    }

    // 优先级标识
    if (task.priority) {
      const priorityConfig = getPriorityConfig(task.priority);
      const priorityBadge = content.createEl('span', {
        text: priorityConfig.label,
        cls: 'todo-priority-badge'
      });
      priorityBadge.style.backgroundColor = priorityConfig.color + '20'; // 20% 透明度
      priorityBadge.style.color = priorityConfig.color;
    }

    // 标签显示
    const tags = parseTags(task.content);
    if (tags.length > 0) {
      const tagsContainer = content.createEl('div', { cls: 'todo-tags-container' });
      tags.forEach(tag => {
        const tagEl = tagsContainer.createEl('span', {
          text: `#${tag}`,
          cls: 'todo-tag'
        });
        tagEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setTagFilter(tag);
        }, { signal: this.signal });
      });
    }

    const safeContent = SecurityService.sanitizeInput(removeTags(task.content));
    content.createEl('p', { text: safeContent, cls: 'todo-text' });
    
    content.addEventListener('dblclick', () => {
      this.showEditDialog(task, card);
    }, { signal: this.signal });
    
    if (task.dueDate) {
      content.createEl('p', { 
        text: `截止: ${task.dueDate}`, 
        cls: 'todo-due-date' 
      });
    }
    
    if (task.link) {
      const safeLink = SecurityService.sanitizeLink(task.link);
      if (safeLink) {
        const linkEl = content.createEl('a', {
          text: '打开链接',
          cls: 'todo-link',
          href: safeLink,
          target: '_blank'
        });
      }
    }
    
    const actions = card.createEl('div', { cls: 'todo-actions' });
    
    const deleteBtn = actions.createEl('button', {
      text: '×',
      cls: 'todo-delete-button'
    });
  }
  
  async saveTasksOrder(container, taskDate) {
    const cards = container.querySelectorAll('.todo-card');
    const newOrder = [];
    cards.forEach(card => {
      const taskId = card.dataset.taskId;
      const cardDate = card.dataset.date;
      // 安全检查：只保存属于当前日期组的任务，防止跨日期移动
      if (cardDate !== taskDate) return;
      
      const task = this.plugin.findTaskById(taskId);
      if (task) {
        newOrder.push(task);
      }
    });
    await this.plugin.updateTasksOrder(taskDate, newOrder);
  }
}

class TodoKanbanPlugin extends Plugin {
  constructor(app, manifest) {
    super(app, manifest);
    this.tasksData = { version: '1.2.0', tasks: [], lastModified: new Date().toISOString() };
    this.taskIdIndex = new Map(); // taskId -> { date, task }
    this.dateIndex = new Map();   // date -> dateTask
    this.timerManager = new TimerManager(); // 定时器管理器
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
    this.registerView('todo-kanban-view', (leaf) => new TodoView(leaf, this));
    
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

  // 保存任务数据（带备份和错误处理）
  async saveTasks() {
    try {
      // 先备份当前数据
      const backupPath = this.tasksFilePath.replace('.json', '-backup.json');
      await this.app.vault.adapter.write(backupPath, JSON.stringify(this.tasksData, null, 2));

      // 更新最后修改时间
      this.tasksData.lastModified = new Date().toISOString();

      // 然后保存新数据
      await this.app.vault.adapter.write(this.tasksFilePath, JSON.stringify(this.tasksData, null, 2));

      // 更新索引
      this.buildIndexes();
    } catch (error) {
      ErrorHandler.handle(error, '保存任务数据');
      throw error; // 重新抛出，让调用者处理
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
        // 使用 Object.assign 创建新的任务对象，避免引用问题
        dateTask.tasksList[taskIndex] = Object.assign({}, updatedTask);
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

// 导出对话框
class ExportModal extends Modal {
  constructor(app, view) {
    super(app);
    this.view = view;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h2', { text: '导出待办任务' });
    
    // 开始日期
    const startRow = contentEl.createEl('div', { cls: 'export-row' });
    startRow.createEl('label', { text: '开始日期：' });
    const startInput = startRow.createEl('input', { type: 'date', cls: 'export-date-input' });
    
    // 结束日期
    const endRow = contentEl.createEl('div', { cls: 'export-row' });
    endRow.createEl('label', { text: '结束日期：' });
    const endInput = endRow.createEl('input', { type: 'date', cls: 'export-date-input' });
    
    // 设置默认值为今天
    const today = formatDate(new Date());
    startInput.value = today;
    endInput.value = today;
    
    // 按钮区域
    const buttonRow = contentEl.createEl('div', { cls: 'export-buttons' });
    
    buttonRow.createEl('button', { text: '导出', cls: 'export-confirm-btn' }).addEventListener('click', () => {
      if (!startInput.value || !endInput.value) {
        alert('请选择日期范围');
        return;
      }
      
      if (new Date(startInput.value) > new Date(endInput.value)) {
        alert('开始日期不能大于结束日期');
        return;
      }
      
      this.view.exportTasksToCSV(startInput.value, endInput.value);
      this.close();
    });
    
    buttonRow.createEl('button', { text: '取消', cls: 'export-cancel-btn' }).addEventListener('click', () => {
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

// 编辑对话框
class EditModal extends Modal {
  constructor(app, view, task, card) {
    super(app);
    this.view = view;
    this.task = task;
    this.card = card;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    
    contentEl.createEl('h2', { text: '编辑任务' });
    
    // 任务内容
    const contentRow = contentEl.createEl('div', { cls: 'edit-row' });
    contentRow.createEl('label', { text: '任务内容：' });
    const contentInput = contentRow.createEl('textarea', { 
      cls: 'edit-content-input'
    });
    contentInput.value = this.task.content;
    
    // 链接
    const linkRow = contentEl.createEl('div', { cls: 'edit-row' });
    linkRow.createEl('label', { text: '链接：' });
    const linkInput = linkRow.createEl('input', { 
      type: 'text',
      cls: 'edit-input',
      value: this.task.link || '',
      placeholder: 'https://...'
    });
    
    // 截止日期
    const dateRow = contentEl.createEl('div', { cls: 'edit-row' });
    dateRow.style.cursor = 'pointer';
    dateRow.createEl('label', { text: '截止日期：' });
    const dateInput = dateRow.createEl('input', {
      type: 'date',
      cls: 'edit-input',
      value: this.task.dueDate || ''
    });
    // 点击整行触发日期选择器
    dateRow.addEventListener('click', (e) => {
      if (e.target !== dateInput) {
        e.stopPropagation();
        setTimeout(() => {
          dateInput.focus();
          dateInput.click();
        }, 0);
      }
    });

    // 优先级
    const priorityRow = contentEl.createEl('div', { cls: 'edit-row' });
    priorityRow.createEl('label', { text: '优先级：' });
    const priorityInput = priorityRow.createEl('select', { cls: 'edit-input' });
    priorityInput.add(new Option('无', 'none'));
    priorityInput.add(new Option('高', 'high'));
    priorityInput.add(new Option('中', 'medium'));
    priorityInput.add(new Option('低', 'low'));
    priorityInput.value = this.task.priority || 'none';

    // 按钮区域
    const buttonRow = contentEl.createEl('div', { cls: 'edit-buttons' });

    buttonRow.createEl('button', { text: '保存', cls: 'edit-confirm-btn' }).addEventListener('click', async () => {
      const newContent = contentInput.value.trim();
      if (!newContent) {
        alert('任务内容不能为空');
        return;
      }

      try {
        // 验证和消毒任务内容
        const validatedContent = SecurityService.validateTaskContent(newContent);
        const safeLink = SecurityService.sanitizeLink(linkInput.value.trim());

        // 更新任务数据
        this.task.content = validatedContent;
        this.task.link = safeLink || null;
        this.task.dueDate = dateInput.value || null;
        this.task.priority = priorityInput.value !== 'none' ? priorityInput.value : null;

        // 保存到插件数据
        await this.view.plugin.updateTask(this.task.taskId, this.task);

        // 重新渲染任务列表以触发排序
        this.view.renderTasks();

        this.close();
      } catch (error) {
        ErrorHandler.handle(error, '编辑任务');
      }
    });
    
    buttonRow.createEl('button', { text: '取消', cls: 'edit-cancel-btn' }).addEventListener('click', () => {
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

module.exports = TodoKanbanPlugin;