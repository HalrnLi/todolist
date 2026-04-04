const { ItemView } = require('obsidian');
const { generateUUID, PRIORITY, getPriorityConfig, parseTags, removeTags, isUrgentTask } = require('../models');
const { formatDate, formatDateTime, getWeekStartDate, getWeekEndDate } = require('../utils/date');
const SecurityService = require('../services/SecurityService');
const EditModal = require('../modals/EditModal');
const ExportModal = require('../modals/ExportModal');

// 搜索防抖定时器
let searchDebounceTimer = null;

// 待办视图
class TodoView extends ItemView {
  constructor(leaf, plugin, errorHandler) {
    super(leaf);
    this.plugin = plugin;
    this.errorHandler = errorHandler;
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

    // 优先级筛选
    filterSection.createEl('label', { text: '优先级：', cls: 'todo-filter-label' });
    this.priorityFilterSelect = filterSection.createEl('select', { cls: 'todo-filter-select' });
    this.priorityFilterSelect.add(new Option('全部', 'all'));
    this.priorityFilterSelect.add(new Option('高', 'high'));
    this.priorityFilterSelect.add(new Option('中', 'medium'));
    this.priorityFilterSelect.add(new Option('低', 'low'));
    this.priorityFilterSelect.add(new Option('无', 'none'));
    this.priorityFilterSelect.addEventListener('change', () => this.renderTasks(), { signal: this.signal });

    // 搜索框（带防抖）
    this.searchInput = filterSection.createEl('input', {
      type: 'text',
      placeholder: '搜索待办...',
      cls: 'todo-search-input'
    });
    this.searchInput.addEventListener('input', () => {
      // 清除之前的定时器
      if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
      }
      // 设置新的防抖定时器（150-200ms）
      searchDebounceTimer = setTimeout(() => {
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
    // 清理搜索防抖定时器
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
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
        this.errorHandler.handle(error, '添加任务');
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

        // 任务列表
        const tasksList = document.createElement('div');
        tasksList.className = 'todo-tasks-list';

        // 排序逻辑：未完成任务在前 > 紧急任务 > 优先级 > 截止时间 > 已完成任务在后
        const sortedTasks = [...dateTask.tasksList].sort((a, b) => {
          // 已完成的任务排在最后
          if (a.completed && !b.completed) return 1;
          if (!a.completed && b.completed) return -1;

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

module.exports = TodoView;
