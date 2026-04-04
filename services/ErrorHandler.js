// 错误处理类 - Notice类通过构造函数传入
class ErrorHandler {
  constructor(NoticeClass) {
    this.NoticeClass = NoticeClass;
  }

  handle(error, context = '未知错误') {
    console.error(`[${context}]`, error);

    // 显示用户友好的错误提示
    if (this.NoticeClass) {
      const notice = new this.NoticeClass(`操作失败: ${error.message}`, 5000);
      notice.show();
    }
  }
}

module.exports = ErrorHandler;
