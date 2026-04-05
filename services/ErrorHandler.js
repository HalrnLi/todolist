// 错误处理类 - Notice类通过构造函数传入
class ErrorHandler {
  constructor(NoticeClass) {
    // 类型检查：确保 NoticeClass 是构造函数
    if (NoticeClass && typeof NoticeClass === 'function') {
      this.NoticeClass = NoticeClass;
    } else {
      this.NoticeClass = null;
    }
  }

  handle(error, context = '未知错误') {
    console.error(`[${context}]`, error);

    // 显示用户友好的错误提示
    if (this.NoticeClass) {
      try {
        const notice = new this.NoticeClass(`操作失败: ${error.message}`, 5000);
        notice.show();
      } catch (e) {
        // 如果 Notice 创建失败，至少记录错误
        console.error(`[${context}] 通知显示失败:`, e);
      }
    }
  }
}

module.exports = ErrorHandler;
