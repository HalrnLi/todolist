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

module.exports = SecurityService;
