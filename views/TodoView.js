const { ItemView, Notice, Menu, Modal } = require('obsidian');
const { generateUUID, PRIORITY, getPriorityConfig, parseTags, removeTags, isUrgentTask } = require('../models');
const { formatDate, formatDateTime, getWeekStartDate, getWeekEndDate } = require('../utils/date');
const SecurityService = require('../services/SecurityService');
const EditModal = require('../modals/EditModal');
const ExportModal = require('../modals/ExportModal');

// 待办视图
class TodoView extends ItemView {
  constructor(leaf, plugin, errorHandler) {
    super(leaf);
    this.plugin = plugin;
    this.errorHandler = errorHandler;
    // 用于清理事件监听器的 AbortController
    this.abortController = new AbortController();
    this.signal = this.abortController.signal;
    // 防抖定时器（搜索和筛选器共用）
    this.searchDebounceTimer = null;
    this.filterDebounceTimer = null;
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
    
    const filterSection = container.createEl('div', { cls: 'todo-filter-section' });
    filterSection.style.flexShrink = '0';
    filterSection.createEl('label', { text: '查看范围：', cls: 'todo-filter-label' });
    this.filterSelect = filterSection.createEl('select', { cls: 'todo-filter-select' });
    this.filterSelect.add(new Option('当日待办', 'today'));
    this.filterSelect.add(new Option('近7天', '7days'));
    this.filterSelect.add(new Option('近30天', '30days'));
    this.filterSelect.add(new Option('本周', 'week'));
    this.filterSelect.add(new Option('全部日期', 'all'));
    this.filterSelect.addEventListener('change', () => {
      clearTimeout(this.filterDebounceTimer);
      this.filterDebounceTimer = setTimeout(() => this.renderTasks(), 100);
    }, { signal: this.signal });

    // 优先级筛选
    filterSection.createEl('label', { text: '优先级：', cls: 'todo-filter-label' });
    this.priorityFilterSelect = filterSection.createEl('select', { cls: 'todo-filter-select' });
    this.priorityFilterSelect.add(new Option('全部', 'all'));
    this.priorityFilterSelect.add(new Option('高', 'high'));
    this.priorityFilterSelect.add(new Option('中', 'medium'));
    this.priorityFilterSelect.add(new Option('低', 'low'));
    this.priorityFilterSelect.add(new Option('无', 'none'));
    this.priorityFilterSelect.addEventListener('change', () => {
      clearTimeout(this.filterDebounceTimer);
      this.filterDebounceTimer = setTimeout(() => this.renderTasks(), 100);
    }, { signal: this.signal });

    // 搜索框（带防抖）
    this.searchInput = filterSection.createEl('input', {
      type: 'text',
      placeholder: '搜索待办...',
      cls: 'todo-search-input'
    });
    this.searchInput.addEventListener('input', () => {
      // 清除之前的定时器
      if (this.searchDebounceTimer) {
        clearTimeout(this.searchDebounceTimer);
      }
      // 设置新的防抖定时器（150-200ms）
      this.searchDebounceTimer = setTimeout(() => {
        this.renderTasks();
      }, 150);
    }, { signal: this.signal });

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

    const tasks = this.plugin.tasksData?.tasks || [];
    let totalTasks = 0, completedTasks = 0;
    for (const dateTask of tasks) {
      const list = dateTask.tasksList || [];
      totalTasks += list.length;
      completedTasks += list.filter(task => task.completed === true).length;
    }
    this.taskCountBadge = filterSection.createEl('span', { cls: 'todo-task-count-badge' });
    this._updateTaskCountBadge();

    this.todoContainer = container.createEl('div', { cls: 'todo-container' });
    this.todoContainer.style.flex = '1 1 0';
    this.todoContainer.style.minHeight = '0';
    this.todoContainer.style.overflowY = 'auto';
    this.todoContainer.style.overflowX = 'hidden';
    
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
    const dateRow = inputSection.createEl('div', { cls: 'todo-input-row todo-input-row-with-date' });
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
      this.taskPriority.value = 'none';
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

    this.setupEventDelegation(this.signal);
    this.setupDragDelegation();

    // 双击编辑委托（容器级别，避免重复绑定）
    this.todoContainer.addEventListener('dblclick', (e) => {
      const content = e.target.closest('.todo-content');
      if (!content) return;
      const card = content.closest('.todo-card');
      if (!card) return;
      const taskId = card.dataset.taskId;
      const task = this.plugin.findTaskById(taskId);
      if (task) {
        this.showEditDialog(task, card);
      }
    }, { signal: this.signal });

    // 渲染任务
    this.renderTasks();
  }

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

    // 右键菜单委托
    this.todoContainer.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('.todo-card');
      if (!card) return;
      e.preventDefault();
      const taskId = card.dataset.taskId;
      this.showReminderMenu(e, taskId);
    }, { signal });

    // 注：拖拽排序事件由 createTaskCard 中的事件处理程序管理
    // 这样可以确保拖拽只能在同一日期组内进行，避免跨日期移动任务
  }

  // 容器级别拖拽委托 —— 替代逐卡片绑定
  setupDragDelegation() {
    if (!this.todoContainer) return;

    this.todoContainer.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.todo-card');
      if (!card) return;
      card.classList.add('todo-card-dragging');
      this._dragState = { taskId: card.dataset.taskId, sourceContainer: card.parentElement, sourceDate: card.dataset.date };
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
      e.dataTransfer.effectAllowed = 'move';
    }, { signal: this.signal });

    this.todoContainer.addEventListener('dragend', (e) => {
      const card = e.target.closest('.todo-card');
      if (card) card.classList.remove('todo-card-dragging');
      this._dragState = null;
    }, { signal: this.signal });

    this.todoContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const draggingCard = this.todoContainer.querySelector('.todo-card-dragging');
      const targetCard = e.target.closest('.todo-card');
      if (!draggingCard || !targetCard || draggingCard === targetCard) return;
      if (draggingCard.parentElement !== targetCard.parentElement) return;

      const rect = targetCard.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const container = targetCard.parentElement;
      if (e.clientY < midY) {
        container.insertBefore(draggingCard, targetCard);
      } else {
        container.insertBefore(draggingCard, targetCard.nextSibling);
      }
    }, { signal: this.signal });

    this.todoContainer.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetCard = e.target.closest('.todo-card');
      if (!targetCard) return;
      const container = targetCard.parentElement;
      const state = this._dragState;
      if (!state || container !== state.sourceContainer) return;
      if (state.sourceDate) {
        await this.saveTasksOrder(container, state.sourceDate);
      }
    }, { signal: this.signal });
  }

  // 更新卡片内容（不重建 DOM 节点，只更新内容）
  updateCardContent(card, task) {
    const todayStr = formatDate(new Date());
    const isUrgent = isUrgentTask(task, todayStr);
    const content = card.querySelector('.todo-content');
    if (!content) return;

    // 更新类名
    card.className = `todo-card${task.completed ? ' todo-card-completed' : ''}${isUrgent ? ' todo-card-urgent' : ''}`;
    card.dataset.completed = task.completed.toString();

    // 更新 checkbox
    const checkbox = card.querySelector('.todo-checkbox');
    if (checkbox) checkbox.checked = task.completed;

    // 清空并重建 content 内部
    content.empty();

    if (isUrgent) {
      content.createEl('span', { text: '🔴 紧急', cls: 'todo-urgent-badge' });
    }

    if (task.priority) {
      const priorityConfig = getPriorityConfig(task.priority);
      const priorityBadge = content.createEl('span', {
        text: priorityConfig.label,
        cls: 'todo-priority-badge'
      });
      priorityBadge.style.backgroundColor = priorityConfig.color + '20';
      priorityBadge.style.color = priorityConfig.color;
    }

    const tags = parseTags(task.content);
    if (tags.length > 0) {
      const tagsContainer = content.createEl('div', { cls: 'todo-tags-container' });
      tags.forEach(tag => {
        const tagEl = tagsContainer.createEl('span', { text: `#${tag}`, cls: 'todo-tag' });
        tagEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setTagFilter(tag);
        }, { signal: this.signal });
      });
    }

    const textEl = content.createEl('p', { cls: 'todo-text' });
    textEl.textContent = removeTags(task.content);

    // dblclick 编辑已通过容器级委托处理，不再逐卡片绑定

    if (task.dueDate) {
      content.createEl('p', { text: `截止: ${task.dueDate}`, cls: 'todo-due-date' });
    }

    if (task.link) {
      const safeLink = SecurityService.sanitizeLink(task.link);
      if (safeLink) {
        content.createEl('a', {
          text: '打开链接',
          cls: 'todo-link',
          href: safeLink,
          target: '_blank',
          rel: 'noopener noreferrer'
        });
      }
    }

    // 闹钟图标
    const actions = card.querySelector('.todo-actions');
    if (actions) {
      const existingIcon = actions.querySelector('.todo-reminder-icon');
      if (this.plugin.reminderService?.hasReminder(task.taskId)) {
        if (!existingIcon) {
          const remaining = this.plugin.reminderService.getRemainingTime(task.taskId);
          const mins = Math.ceil(remaining / 60000);
          const alarmIcon = createEl('span', {
            cls: 'todo-reminder-icon',
            text: '⏰',
            attr: { 'data-task-id': task.taskId, title: `${mins} 分钟后提醒` }
          });
          actions.insertBefore(alarmIcon, actions.firstChild);
        }
      } else if (existingIcon) {
        existingIcon.remove();
      }
    }
  }

  async handleTaskComplete(taskId, completed) {
    try {
      const task = this.plugin.findTaskById(taskId);
      if (task) {
        await this.plugin.updateTask(taskId, { ...task, completed });
        // 直接更新卡片，不全量重渲染
        const card = this.todoContainer.querySelector(`.todo-card[data-task-id="${taskId}"]`);
        if (card) {
          this.updateCardContent(card, { ...task, completed });
          // 更新排序：完成的任务移到底部
          const tasksList = card.parentElement;
          if (tasksList) {
            tasksList.appendChild(card);
          }
        }
        this._updateTaskCountBadge();
      }
    } catch (error) {
      this.errorHandler.handle(error, '完成任务');
    }
  }

  async handleTaskDelete(taskId) {
    try {
      await this.plugin.deleteTask(taskId);
      // 直接移除卡片，不全量重渲染
      const card = this.todoContainer.querySelector(`.todo-card[data-task-id="${taskId}"]`);
      if (card) {
        const tasksList = card.parentElement;
        card.remove();
        // 如果日期组空了，移除整个日期组
        if (tasksList && tasksList.children.length === 0) {
          const dateSection = tasksList.closest('.todo-date-section');
          if (dateSection) dateSection.remove();
        }
      }
      this._updateTaskCountBadge();
    } catch (error) {
      this.errorHandler.handle(error, '删除任务');
    }
  }

  async onClose() {
    this.abortController.abort();
    // 清理搜索防抖定时器
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    // 清理筛选器防抖定时器
    if (this.filterDebounceTimer) {
      clearTimeout(this.filterDebounceTimer);
      this.filterDebounceTimer = null;
    }
  }

  // 添加任务（带输入验证）
  async addTasks() {
    const inputText = this.taskInput.value.trim();
    if (!inputText) return;

    const tasks = inputText.split('\n').filter(task => task.trim());
    const today = new Date();
    const dateStr = formatDate(today);
    const timeStr = formatDateTime(today);

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
        this.errorHandler.handle(error, '添加任务');
        return;
      }
    }

    this.taskInput.value = '';
    this.taskLink.value = '';
    this.taskDueDate.value = '';
    this.taskPriority.value = 'none';
    this.renderTasks();
  }

  _updateTaskCountBadge() {
    if (!this.taskCountBadge) return;
    const tasks = this.plugin.tasksData?.tasks || [];
    let totalTasks = 0, completedTasks = 0;
    for (const dateTask of tasks) {
      const list = dateTask.tasksList || [];
      totalTasks += list.length;
      completedTasks += list.filter(task => task.completed === true).length;
    }
    this.taskCountBadge.textContent = `已完成 ${completedTasks} / ${totalTasks}`;
  }

  // 安全解析日期，无效日期返回 null
  _safeParseDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  }

  // 渲染任务（diff 模式：只更新变化的卡片，不全量重建 DOM）
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
        const taskDate = this._safeParseDate(task.date);
        return taskDate && taskDate >= sevenDaysAgo && taskDate <= today;
      });
    } else if (filter === '30days') {
      const thirtyDaysAgo = new Date(today);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      filteredTasks = filteredTasks.filter(task => {
        const taskDate = this._safeParseDate(task.date);
        return taskDate && taskDate >= thirtyDaysAgo && taskDate <= today;
      });
    } else if (filter === 'week') {
      const weekStart = getWeekStartDate(today);
      const weekEnd = getWeekEndDate(today);
      filteredTasks = filteredTasks.filter(task => {
        const taskDate = this._safeParseDate(task.date);
        return taskDate && taskDate >= weekStart && taskDate <= weekEnd;
      });
    }

    // 搜索过滤关键词（提前提取，避免重复计算）
    const searchKeyword = this.searchInput.value.trim().toLowerCase();

    // 优先级筛选值
    const priorityFilter = this.priorityFilterSelect?.value;

    // 标签筛选（提前提取）
    const tagFilter = this.currentTagFilter;

    // 合并多个过滤条件到单次遍历（优化性能）
    if (searchKeyword || tagFilter || (priorityFilter && priorityFilter !== 'all')) {
      filteredTasks = filteredTasks
        .map(dateTask => {
          // 应用所有任务过滤条件
          const filteredTasksList = dateTask.tasksList.filter(task => {
            // 搜索过滤
            if (searchKeyword) {
              const contentMatch = task.content.toLowerCase().includes(searchKeyword);
              const linkMatch = task.link && task.link.toLowerCase().includes(searchKeyword);
              const dueDateMatch = task.dueDate && task.dueDate.includes(searchKeyword);
              if (!contentMatch && !linkMatch && !dueDateMatch) return false;
            }
            // 标签过滤
            if (tagFilter) {
              const tags = parseTags(task.content);
              if (!tags.includes(tagFilter)) return false;
            }
            // 优先级过滤
            if (priorityFilter && priorityFilter !== 'all') {
              if (priorityFilter === 'none') {
                if (task.priority) return false;
              } else if (task.priority !== priorityFilter) {
                return false;
              }
            }
            return true;
          });
          return { ...dateTask, tasksList: filteredTasksList };
        })
        .filter(dateTask => dateTask.tasksList.length > 0);
    }

    // 按日期倒序排序（今天在上面，历史在下面）
    filteredTasks.sort((a, b) => {
      const dateA = this._safeParseDate(a.date);
      const dateB = this._safeParseDate(b.date);
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateB.getTime() - dateA.getTime();
    });

    this._updateTaskCountBadge();

    if (filteredTasks.length === 0) {
      this.todoContainer.empty();
      const emptyEl = document.createElement('p');
      emptyEl.textContent = '没有任务，添加一个吧！';
      emptyEl.className = 'todo-empty';
      this.todoContainer.appendChild(emptyEl);
      return;
    }

    // === Diff 渲染：收集现有卡片，按 taskId 索引 ===
    const existingCards = new Map();
    this.todoContainer.querySelectorAll('.todo-card').forEach(card => {
      existingCards.set(card.dataset.taskId, card);
    });

    // 使用 DocumentFragment 减少重排
    const fragment = document.createDocumentFragment();

    for (const dateTask of filteredTasks) {
      const isToday = dateTask.date === todayStr;

      const dateSection = document.createElement('div');
      dateSection.className = `todo-date-section${isToday ? ' todo-date-today' : ''}`;

      // 日期标题
      const dateHeader = document.createElement('div');
      dateHeader.className = 'todo-date-header';
      const dateTitle = document.createElement('h3');
      dateTitle.textContent = isToday ? `${dateTask.date} (今天)` : dateTask.date;
      dateTitle.className = 'todo-date-title';
      dateHeader.appendChild(dateTitle);

      // 清空按钮
      const clearBtn = document.createElement('button');
      clearBtn.textContent = '清空';
      clearBtn.className = 'todo-clear-date-button';
      clearBtn.addEventListener('click', async () => {
        if (confirm(`确定要清空 ${dateTask.date} 的所有任务吗？`)) {
          try {
            await this.plugin.deleteTasksByDate(dateTask.date);
            this.renderTasks();
          } catch (error) {
            this.errorHandler.handle(error, '清空任务');
          }
        }
      }, { signal: this.signal });
      dateHeader.appendChild(clearBtn);
      dateSection.appendChild(dateHeader);

      // 任务列表容器
      const tasksContainer = document.createElement('div');
      tasksContainer.className = 'todo-date-tasks';

      // 任务列表
      const tasksList = document.createElement('div');
      tasksList.className = 'todo-tasks-list';

      // 排序逻辑：未完成任务在前 > 提醒置顶 > 紧急任务 > 优先级 > 截止时间 > 已完成任务在后
      const reminderService = this.plugin.reminderService;
      const sortedTasks = [...dateTask.tasksList].sort((a, b) => {
        if (a.completed && !b.completed) return 1;
        if (!a.completed && b.completed) return -1;

        const aHasReminder = reminderService?.hasReminder(a.taskId);
        const bHasReminder = reminderService?.hasReminder(b.taskId);
        if (aHasReminder && !bHasReminder) return -1;
        if (!aHasReminder && bHasReminder) return 1;

        const aIsUrgent = isUrgentTask(a, todayStr);
        const bIsUrgent = isUrgentTask(b, todayStr);

        if (aIsUrgent && !bIsUrgent) return -1;
        if (!aIsUrgent && bIsUrgent) return 1;

        const aPriority = getPriorityConfig(a.priority).order;
        const bPriority = getPriorityConfig(b.priority).order;
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }

        if (!a.dueDate && b.dueDate) return -1;
        if (a.dueDate && !b.dueDate) return 1;
        if (!a.dueDate && !b.dueDate) return 0;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });

      // 渲染任务卡片 —— 复用已有 DOM 节点
      for (const task of sortedTasks) {
        let card = existingCards.get(task.taskId);
        if (card) {
          // 已存在 → 更新内容，不重建
          this.updateCardContent(card, task);
        } else {
          // 新卡片
          card = this.createTaskCard(tasksList, task, dateTask.date);
        }
        tasksList.appendChild(card);
      }

      tasksContainer.appendChild(tasksList);
      dateSection.appendChild(tasksContainer);
      fragment.appendChild(dateSection);
    }

    // 替换容器内容（一次性操作，减少重排）
    this.todoContainer.empty();
    this.todoContainer.appendChild(fragment);
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
    const modal = new EditModal(this.app, this, task, card, this.errorHandler);
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
    const safeLink = SecurityService.sanitizeLink(task.link);
    if (safeLink) {
      if (linkEl) {
        linkEl.href = safeLink;
      } else {
        content.createEl('a', {
          text: '打开链接',
          cls: 'todo-link',
          href: safeLink,
          target: '_blank',
          rel: 'noopener noreferrer'
        });
      }
    } else if (linkEl) {
      linkEl.remove();
    }
  }

  // 显示提醒右键菜单
  showReminderMenu(e, taskId) {
    const menu = new Menu();
    const reminderService = this.plugin.reminderService;
    const task = this.plugin.findTaskById(taskId);
    if (!task || !reminderService) return;

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
          reminderService.setReminder(taskId, task.content, preset.ms, task.link);
          new Notice(`已设置 ${preset.label} 提醒`, 3000);
          this.renderTasks();
        })
      );
    });

    menu.addItem(item => item
      .setTitle('自定义时间...')
      .onClick(() => {
        const modal = new Modal(this.app);
        modal.titleEl.setText('设置提醒时间');

        const inputEl = modal.contentEl.createEl('input', {
          type: 'number',
          placeholder: '请输入分钟数（1-1440）',
          attr: { min: '1', max: '1440' }
        });
        inputEl.style.width = '100%';
        inputEl.style.padding = '8px';
        inputEl.style.marginTop = '8px';
        inputEl.style.marginBottom = '8px';

        const btnContainer = modal.contentEl.createEl('div');
        btnContainer.style.display = 'flex';
        btnContainer.style.gap = '8px';
        btnContainer.style.justifyContent = 'flex-end';

        const cancelBtn = btnContainer.createEl('button', { text: '取消' });
        cancelBtn.addEventListener('click', () => modal.close());

        const confirmBtn = btnContainer.createEl('button', { text: '确定' });
        confirmBtn.style.backgroundColor = 'var(--interactive-accent)';
        confirmBtn.style.color = 'white';
        confirmBtn.style.border = 'none';
        confirmBtn.style.padding = '6px 16px';
        confirmBtn.style.borderRadius = '4px';
        confirmBtn.addEventListener('click', () => {
          const mins = parseInt(inputEl.value, 10);
          if (!inputEl.value || isNaN(mins) || mins < 1 || mins > 1440) {
            new Notice('请输入 1-1440 之间的正整数', 3000);
            return;
          }
          reminderService.setReminder(taskId, task.content, mins * 60 * 1000, task.link);
          new Notice(`已设置 ${mins} 分钟后提醒`, 3000);
          this.renderTasks();
          modal.close();
        });

        inputEl.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') confirmBtn.click();
        });

        modal.open();
        inputEl.focus();
      })
    );

    if (reminderService.hasReminder(taskId)) {
      menu.addSeparator();
      const remaining = reminderService.getRemainingTime(taskId);
      const mins = Math.ceil(remaining / 60000);
      menu.addItem(item => item
        .setTitle(`⏰ 取消提醒 (剩余 ${mins} 分钟)`)
        .onClick(() => {
          reminderService.cancelReminder(taskId);
          new Notice('已取消提醒', 3000);
          this.renderTasks();
        })
      );
    }

    menu.showAtPosition({ x: e.clientX, y: e.clientY });
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

    // CSV 单元格转义（防止 CSV 注入：公式注入攻击）
    const escapeCSV = (cell) => {
      if (cell === null || cell === undefined) return '';
      const str = String(cell);
      // 如果包含逗号、换行、双引号或以 =/+/-/@ 开头，需要包裹在双引号中
      if (str.includes(',') || str.includes('\n') || str.includes('"') || /^[=+\-@\t]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

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
      new Notice('所选日期范围内没有任务', 3000);
      return;
    }

    // 生成CSV内容
    const headers = ['日期', '任务内容', '状态', '截止日期', '链接', '创建时间'];
    const csvRows = [headers.join(',')];

    for (const task of filteredTasks) {
      const row = [
        escapeCSV(task.date),
        escapeCSV(task.content),
        task.completed,
        escapeCSV(task.dueDate),
        escapeCSV(task.link),
        escapeCSV(task.createAt)
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
    URL.revokeObjectURL(url);
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

    // 拖拽事件由 setupDragDelegation() 在容器级别统一处理
    // 不在每个卡片上绑定，避免 68+ 卡片的重复监听器开销
    
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

    // 使用 textContent 直接设置文本，避免 sanitizeInput + {text:} 的双重转义问题
    const textEl = content.createEl('p', { cls: 'todo-text' });
    textEl.textContent = removeTags(task.content);
    
    // dblclick 编辑已通过容器级委托处理，不再逐卡片绑定
    
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
          target: '_blank',
          rel: 'noopener noreferrer'
        });
      }
    }
    
    const actions = card.createEl('div', { cls: 'todo-actions' });

    // 闹钟图标（仅当有提醒时）
    if (this.plugin.reminderService?.hasReminder(task.taskId)) {
      const remaining = this.plugin.reminderService.getRemainingTime(task.taskId);
      const mins = Math.ceil(remaining / 60000);
      actions.createEl('span', {
        cls: 'todo-reminder-icon',
        text: '⏰',
        attr: { 'data-task-id': task.taskId, title: `${mins} 分钟后提醒` }
      });
    }

    const deleteBtn = actions.createEl('button', {
      text: '×',
      cls: 'todo-delete-button'
    });

    deleteBtn.addEventListener('click', async () => {
      try {
        await this.plugin.deleteTask(task.taskId);
        card.remove();
      } catch (error) {
        this.errorHandler.handle(error, '删除任务');
      }
    }, { signal: this.signal });

    return card;
  }
  
  async saveTasksOrder(container, taskDate) {
    try {
      const cards = container.querySelectorAll('.todo-card');
      const newOrder = [];
      const seenTaskIds = new Set();
      cards.forEach(card => {
        const taskId = card.dataset.taskId;
        if (seenTaskIds.has(taskId)) return;
        seenTaskIds.add(taskId);

        const task = this.plugin.findTaskById(taskId);
        if (task) {
          newOrder.push(task);
        }
      });

      // 校验：确保原日期组中未参与拖拽的任务不被丢失
      const originalDateTask = this.plugin.tasksData.tasks.find(t => t.date === taskDate);
      if (originalDateTask) {
        for (const task of originalDateTask.tasksList) {
          if (!seenTaskIds.has(task.taskId)) {
            newOrder.push(task);
          }
        }
      }

      await this.plugin.updateTasksOrder(taskDate, newOrder);
    } catch (error) {
      this.errorHandler.handle(error, '保存任务顺序');
    }
  }
}

module.exports = TodoView;
