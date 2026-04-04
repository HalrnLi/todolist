const { Modal } = require('obsidian');
const SecurityService = require('../services/SecurityService');
const ErrorHandler = require('../services/ErrorHandler');

// 编辑对话框
class EditModal extends Modal {
  constructor(app, view, task, card, errorHandler) {
    super(app);
    this.view = view;
    this.task = task;
    this.card = card;
    this.errorHandler = errorHandler;
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
        this.errorHandler.handle(error, '编辑任务');
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

module.exports = EditModal;
