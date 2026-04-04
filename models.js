// 生成唯一ID - 使用 crypto.randomUUID()
function generateUUID() {
  return crypto.randomUUID();
}

// 任务优先级定义
const PRIORITY = {
  HIGH: { value: 'high', label: '高', order: 0, color: '#ff5555' },
  MEDIUM: { value: 'medium', label: '中', order: 1, color: '#ffaa00' },
  LOW: { value: 'low', label: '低', order: 2, color: '#55aa55' },
  NONE: { value: 'none', label: '无', order: 3, color: null }
};

// 获取优先级配置
function getPriorityConfig(priorityValue) {
  return Object.values(PRIORITY).find(p => p.value === priorityValue) || PRIORITY.NONE;
}

// 解析任务内容中的标签 (#tag)
function parseTags(content) {
  if (!content || typeof content !== 'string') return [];
  const tagRegex = /#([\w\u4e00-\u9fa5\-_]+)/g;
  const tags = [];
  let match;
  while ((match = tagRegex.exec(content)) !== null) {
    tags.push(match[1]);
  }
  return [...new Set(tags)]; // 去重
}

// 移除内容中的标签标记，返回纯文本
function removeTags(content) {
  if (!content || typeof content !== 'string') return content;
  return content.replace(/#[\w\u4e00-\u9fa5\-_]+/g, '').replace(/\s+/g, ' ').trim();
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

module.exports = {
  generateUUID,
  PRIORITY,
  getPriorityConfig,
  parseTags,
  removeTags,
  isUrgentTask
};
