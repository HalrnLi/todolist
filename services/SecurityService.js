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

    // 自动添加协议前缀（如果没有）
    let processedLink = link.trim();
    if (!/^https?:\/\//i.test(processedLink)) {
      processedLink = 'https://' + processedLink;
    }

    // 验证URL有效性
    try {
      const url = new URL(processedLink);
      return url.protocol === 'http:' || url.protocol === 'https:' ? processedLink : '';
    } catch {
      return '';
    }
  }
}

module.exports = SecurityService;
