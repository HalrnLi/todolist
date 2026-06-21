const { Modal } = require('obsidian');

// 通用确认对话框 —— 替代浏览器原生 confirm()
// 原生 confirm() 在 Obsidian/Electron（尤其移动端）下可能被拦截或样式突兀，
// 改用 Obsidian 的 Modal 以保证桌面/移动端体验一致。
class ConfirmModal extends Modal {
  constructor(app, options = {}) {
    super(app);
    this.title = options.title || '确认操作';
    this.message = options.message || '';
    this.confirmText = options.confirmText || '确定';
    this.cancelText = options.cancelText || '取消';
    this.confirmClass = options.confirmClass || 'mod-warning';
    this.onConfirm = options.onConfirm || (() => {});
    this.onCancel = options.onCancel || (() => {});
    this._confirmed = false;
  }

  onOpen() {
    const { titleEl, contentEl } = this;
    titleEl.setText(this.title);

    if (this.message) {
      contentEl.createEl('p', { text: this.message, cls: 'confirm-message' });
    }

    const btnRow = contentEl.createEl('div', { cls: 'confirm-buttons' });

    const cancelBtn = btnRow.createEl('button', { text: this.cancelText });
    cancelBtn.addEventListener('click', () => {
      this.onCancel();
      this.close();
    });

    const confirmBtn = btnRow.createEl('button', {
      text: this.confirmText,
      cls: this.confirmClass
    });
    confirmBtn.addEventListener('click', () => {
      this._confirmed = true;
      this.onConfirm();
      this.close();
    });
  }

  onClose() {
    // 若用户直接关闭弹窗（ESC/点遮罩）未触发确认按钮，按取消处理
    if (!this._confirmed) {
      this.onCancel();
    }
    const { contentEl } = this;
    contentEl.empty();
  }
}

module.exports = ConfirmModal;
