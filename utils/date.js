// 格式化日期为 YYYY-MM-DD（使用本地时间，避免时区问题）
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return new Date(); // 无效日期返回今天
  }
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

// 获取某周的结束日期（周日）
function getWeekEndDate(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return new Date(); // 无效日期返回今天
  }
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? 0 : 7);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

// 格式化周为 YYYY-MM-DD ~ YYYY-MM-DD
function formatWeek(date) {
  const start = getWeekStartDate(date);
  const end = getWeekEndDate(date);
  return `${formatDate(start)} ~ ${formatDate(end)}`;
}

module.exports = {
  formatDate,
  formatDateTime,
  getWeekStartDate,
  getWeekEndDate,
  formatWeek
};
