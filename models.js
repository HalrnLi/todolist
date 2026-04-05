// 生成唯一ID - 使用 crypto.randomUUID() 并提供兜底方案
function generateUUID() {
  // 优先使用 Web API
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // 兜底方案：使用时间戳和随机数组合
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 15);
  const randomPart2 = Math.random().toString(36).substring(2, 15);
  return `${timestamp}-${randomPart}-${randomPart2}`;
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

// 缓存正则表达式（避免每次调用都创建）
const TAG_REGEX = /#([\w\u4e00-\u9fa5\-_]+)/g;

// 解析任务内容中的标签 (#tag)
function parseTags(content) {
  if (!content || typeof content !== 'string') return [];
  // 每次调用重置正则状态
  TAG_REGEX.lastIndex = 0;
  const tags = [];
  let match;
  while ((match = TAG_REGEX.exec(content)) !== null) {
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

  // 验证日期格式 yyyy-mm-dd
  if (!/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)) return false;

  // 解析 yyyy-mm-dd 格式（无需创建 Date 对象）
  const dueYear = parseInt(task.dueDate.substring(0, 4), 10);
  const dueMonth = parseInt(task.dueDate.substring(5, 7), 10);
  const dueDay = parseInt(task.dueDate.substring(8, 10), 10);

  // 验证日期数值范围有效性
  if (dueMonth < 1 || dueMonth > 12 || dueDay < 1 || dueDay > 31) return false;

  // 计算截止日期前一天的 yyyy-mm-dd
  let prevDay = dueDay - 1;
  let prevMonth = dueMonth;
  let prevYear = dueYear;

  if (prevDay === 0) {
    prevMonth -= 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear -= 1;
    }
    // 使用已知的天数，避免依赖 Date
    const daysInPrevMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][prevMonth - 1];
    // 闰年处理
    if (prevMonth === 2 && ((prevYear % 4 === 0 && prevYear % 100 !== 0) || prevYear % 400 === 0)) {
      prevDay = 29;
    } else {
      prevDay = daysInPrevMonth;
    }
  }

  const oneDayBefore = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevDay).padStart(2, '0')}`;

  // 字符串比较（yyyy-mm-dd 格式可直接比较）
  return todayStr >= oneDayBefore;
}

module.exports = {
  generateUUID,
  PRIORITY,
  getPriorityConfig,
  parseTags,
  removeTags,
  isUrgentTask
};
