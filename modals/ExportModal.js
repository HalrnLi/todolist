const { Modal } = require('obsidian');
const { formatDate } = require('../utils/date');

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

module.exports = ExportModal;
