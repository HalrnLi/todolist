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

// 格式化日期为 YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().split('T')[0];
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
  }

  getViewType() {
    return 'todo-kanban-view';
  }

  getDisplayText() {
    return '待办看板';
  }async onOpen() {
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
    this.filterSelect.addEventListener('change', () => this.renderTasks());
    
    // 搜索框
    this.searchInput = filterSection.createEl('input', {
      type: 'text',
      placeholder: '搜索待办...',
      cls: 'todo-search-input'
    });
    this.searchInput.addEventListener('input', () => this.renderTasks());
    
    // 导出按钮
    const exportBtn = filterSection.createEl('button', {
      text: '导出Excel',
      cls: 'todo-export-button'
    });
    exportBtn.addEventListener('click', () => this.showExportDialog());
    
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
    dateRow.createEl('label', { text: '截止日期（可选）：', cls: 'todo-input-label' });
    this.taskDueDate = dateRow.createEl('input', {
      type: 'date',
      cls: 'todo-date-input'
    });
    
    // 按钮容器
    const buttonContainer = inputSection.createEl('div', { cls: 'todo-input-buttons' });
    buttonContainer.createEl('button', {
      text: '添加',
      cls: 'todo-add-button'
    }).addEventListener('click', () => this.addTasks());
    
    buttonContainer.createEl('button', {
      text: '清空',
      cls: 'todo-clear-button'
    }).addEventListener('click', () => {
      this.taskInput.value = '';
      this.taskLink.value = '';
      this.taskDueDate.value = '';
    });
    
    // 回车添加任务，Shift+Enter 换行
    this.taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.addTasks();
      }
    });
    
    // 自动调整输入框高度
    this.taskInput.addEventListener('input', () => {
      this.taskInput.style.height = 'auto';
      this.taskInput.style.height = Math.min(this.taskInput.scrollHeight, 200) + 'px';
    });
    
    // 渲染任务
    this.renderTasks();
  }

  async onClose() {
    // 视图关闭时的清理工作
  }

  // 添加任务
  async addTasks() {
    const inputText = this.taskInput.value.trim();
    if (!inputText) return;
    
    const tasks = inputText.split('\n').filter(task => task.trim());
    const today = new Date();
    const dateStr = formatDate(today);
    const timeStr = formatDateTime(today);
    
    // 获取链接和截止日期
    const link = this.taskLink.value.trim() || null;
    const dueDate = this.taskDueDate.value || null;
    
    for (const taskContent of tasks) {
      const newTask = {
        taskId: generateUUID(),
        content: taskContent.trim(),
        completed: false,
        createAt: timeStr,
        link: link,
        dueDate: dueDate
      };
      
      await this.plugin.addTask(dateStr, newTask);
    }
    
    this.taskInput.value = '';
    this.taskLink.value = '';
    this.taskDueDate.value = '';
    this.renderTasks();
  }

  // 渲染任务
  renderTasks() {
    this.todoContainer.empty();
    
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
    
    // 按日期倒序排序（今天在上面，历史在下面）
    filteredTasks.sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
    
    if (filteredTasks.length === 0) {
      this.todoContainer.createEl('p', { text: '没有任务，添加一个吧！', cls: 'todo-empty' });
      return;
    }
    
    // 渲染每个日期的任务
    filteredTasks.forEach(dateTask => {
      const isHistory = dateTask.date !== todayStr;
      
      const dateSection = this.todoContainer.createEl('div', { cls: 'todo-date-section' });
      
      // 日期标题
      const dateHeader = dateSection.createEl('div', { cls: 'todo-date-header' });
      const dateTitle = dateHeader.createEl('h3', { 
        text: dateTask.date === todayStr ? `${dateTask.date} (今天)` : dateTask.date, 
        cls: 'todo-date-title' 
      });
      
      // 清空按钮
      const clearBtn = dateHeader.createEl('button', {
        text: '清空',
        cls: 'todo-clear-date-button'
      });
      clearBtn.addEventListener('click', async () => {
        if (confirm(`确定要清空 ${dateTask.date} 的所有任务吗？`)) {
          await this.plugin.deleteTasksByDate(dateTask.date);
          this.renderTasks();
        }
      });
      
      // 任务列表
      const tasksContainer = dateSection.createEl('div', { cls: 'todo-date-tasks' });
      
      // 状态筛选器（只显示未完成和已完成）
      const statusFilter = tasksContainer.createEl('div', { cls: 'todo-status-filter' });
      
      statusFilter.createEl('button', {
        text: '未完成',
        cls: 'todo-status-button todo-status-active'
      }).addEventListener('click', (e) => {
        this.updateStatusFilter(e.target, tasksContainer, 'incomplete');
      });
      
      statusFilter.createEl('button', {
        text: '已完成',
        cls: 'todo-status-button'
      }).addEventListener('click', (e) => {
        this.updateStatusFilter(e.target, tasksContainer, 'completed');
      });
      
      // 任务列表
      const tasksList = tasksContainer.createEl('div', { cls: 'todo-tasks-list' });
      
      // 按截止时间排序：紧急置顶任务优先，无截止时间的在最上面，有截止时间的按时间从近到远排序
      const sortedTasks = [...dateTask.tasksList].sort((a, b) => {
        const aIsUrgent = isUrgentTask(a, todayStr);
        const bIsUrgent = isUrgentTask(b, todayStr);
        
        // 紧急任务置顶
        if (aIsUrgent && !bIsUrgent) return -1;
        if (!aIsUrgent && bIsUrgent) return 1;
        
        // 如果a没有截止时间，a排在前面
        if (!a.dueDate && b.dueDate) return -1;
        // 如果b没有截止时间，b排在前面
        if (a.dueDate && !b.dueDate) return 1;
        // 如果都没有截止时间，保持原顺序
        if (!a.dueDate && !b.dueDate) return 0;
        // 如果都有截止时间，按时间从近到远排序
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });
      
      sortedTasks.forEach(task => {
        this.createTaskCard(tasksList, task, dateTask.date);
      });
      
      // 默认筛选未完成
      this.updateStatusFilter(statusFilter.querySelector('.todo-status-button'), tasksContainer, 'incomplete');
    });
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
    });
    
    card.addEventListener('dragend', () => {
      card.classList.remove('todo-card-dragging');
    });
    
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
    });
    
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      await this.saveTasksOrder(container, taskDate);
    });
    
    const checkbox = card.createEl('input', {
      type: 'checkbox',
      checked: task.completed,
      cls: 'todo-checkbox'
    });
    checkbox.addEventListener('change', async () => {
      task.completed = checkbox.checked;
      card.dataset.completed = checkbox.checked.toString();
      await this.plugin.updateTask(task.taskId, task);
      if (task.completed) {
        card.classList.add('todo-card-completed');
      } else {
        card.classList.remove('todo-card-completed');
      }
      const tasksContainer = card.closest('.todo-date-tasks');
      if (tasksContainer) {
        const activeButton = tasksContainer.querySelector('.todo-status-active');
        if (activeButton) {
          const status = activeButton.textContent === '未完成' ? 'incomplete' : 'completed';
          this.updateStatusFilter(activeButton, tasksContainer, status);
        }
      }
    });
    
    const content = card.createEl('div', {
      cls: 'todo-content'
    });
    
    // 紧急标识
    if (isUrgent) {
      content.createEl('span', { text: '🔴 紧急', cls: 'todo-urgent-badge' });
    }
    
    content.createEl('p', { text: task.content, cls: 'todo-text' });
    
    content.addEventListener('dblclick', () => {
      this.showEditDialog(task, card);
    });
    
    if (task.dueDate) {
      content.createEl('p', { 
        text: `截止: ${task.dueDate}`, 
        cls: 'todo-due-date' 
      });
    }
    
    if (task.link) {
      const linkEl = content.createEl('a', { 
        text: '打开链接',
        cls: 'todo-link',
        href: task.link,
        target: '_blank'
      });
    }
    
    const actions = card.createEl('div', { cls: 'todo-actions' });
    
    const deleteBtn = actions.createEl('button', {
      text: '×',
      cls: 'todo-delete-button'
    });
    deleteBtn.addEventListener('click', async () => {
      await this.plugin.deleteTask(task.taskId);
      card.remove();
    });
  }
  
  async saveTasksOrder(container, taskDate) {
    const cards = container.querySelectorAll('.todo-card');
    const newOrder = [];
    cards.forEach(card => {
      const taskId = card.dataset.taskId;
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
    this.tasksData = { tasks: [] };
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
    // 清除定时器
    if (this.inheritTimer) {
      clearTimeout(this.inheritTimer);
    }
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
        this.tasksData = JSON.parse(data);
      } else {
        this.tasksData = { tasks: [] };
        await this.saveTasks();
      }
    } catch (error) {
      console.error('Failed to load tasks:', error);
      this.tasksData = { tasks: [] };
    }
  }

  // 保存任务数据
  async saveTasks() {
    try {
      await this.app.vault.adapter.write(this.tasksFilePath, JSON.stringify(this.tasksData, null, 2));
    } catch (error) {
      console.error('Failed to save tasks:', error);
    }
  }

  // 自动继承历史未完成任务到今天（移动而非复制）
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
  }
  
  // 设置凌晨1点的定时任务
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
    
    this.inheritTimer = setTimeout(async () => {
      console.log('Running scheduled inherit task at 1 AM');
      await this.inheritIncompleteTasks();
      // 重新设置下一次定时任务
      this.setupDailyInheritTimer();
    }, delay);
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

  // 根据ID查找任务
  findTaskById(taskId) {
    for (const dateTask of this.tasksData.tasks) {
      const task = dateTask.tasksList.find(t => t.taskId === taskId);
      if (task) {
        return task;
      }
    }
    return null;
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
    dateRow.createEl('label', { text: '截止日期：' });
    const dateInput = dateRow.createEl('input', { 
      type: 'date',
      cls: 'edit-input',
      value: this.task.dueDate || ''
    });
    
    // 按钮区域
    const buttonRow = contentEl.createEl('div', { cls: 'edit-buttons' });
    
    buttonRow.createEl('button', { text: '保存', cls: 'edit-confirm-btn' }).addEventListener('click', async () => {
      const newContent = contentInput.value.trim();
      if (!newContent) {
        alert('任务内容不能为空');
        return;
      }
      
      // 更新任务数据
      this.task.content = newContent;
      this.task.link = linkInput.value.trim() || null;
      this.task.dueDate = dateInput.value || null;
      
      // 保存到插件数据
      await this.view.plugin.updateTask(this.task.taskId, this.task);
      
      // 重新渲染任务列表以触发排序
      this.view.renderTasks();
      
      this.close();
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