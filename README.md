# Todo Kanban for Obsidian

一款 Obsidian 插件，核心解决「当日待办管理」和「历史待办可视化」问题，支持任务创建、完成状态勾选、按日期维度组织，所有数据本地存储，界面适配 Obsidian 原生交互逻辑与主题风格。

An Obsidian plugin that focuses on "daily todo management" and "historical todo visualization". It supports task creation, completion status toggling, and date-based organization. All data is stored locally, with an interface that adapts to Obsidian's native interaction logic and theme styles.

## 功能特性 / Features

### 当日待办看板 / Daily Todo Kanban
- **任务输入**：支持单行/多行任务输入，按 Enter 键添加，Shift+Enter 换行
- **Task Input**: Supports single-line/multi-line task input. Press Enter to add, Shift+Enter for new line
- **附加信息**：添加任务时可选择附带链接和截止日期
- **Additional Info**: Optionally add links and due dates when creating tasks
- **看板展示**：分为「未完成」「已完成」两个分区，卡片式展示
- **Kanban Display**: Divided into "Incomplete" and "Completed" sections with card-style display
- **交互操作**：点击勾选框切换完成状态，勾选后自动从当前筛选视图中移除
- **Interactive Operations**: Click checkbox to toggle completion status, automatically removed from current filter view after checking
- **双击编辑**：双击任务内容可编辑任务信息（内容、链接、截止日期）
- **Double-click Edit**: Double-click task content to edit task info (content, link, due date)
- **智能排序**：紧急任务（截止日期前一天）自动置顶显示，无截止时间的任务次之，有截止时间的按时间排序
- **Smart Sorting**: Urgent tasks (one day before due date) are pinned at top, tasks without due date next, then sorted by due date
- **拖拽排序**：支持拖拽任务卡片调整顺序
- **Drag to Reorder**: Drag task cards to adjust order

### 历史待办可视化 / Historical Todo Visualization
- **数据聚合**：按日期分组展示历史任务，今天在最上面
- **Data Aggregation**: Display historical tasks grouped by date, today at top
- **日期筛选**：支持筛选「当日待办」「近7天」「近30天」「本周」「全部日期」
- **Date Filter**: Supports filtering by "Today", "Last 7 Days", "Last 30 Days", "This Week", "All Dates"
- **状态筛选**：每个日期分组下支持「未完成/已完成」筛选，默认显示未完成任务
- **Status Filter**: Each date group supports "Incomplete/Completed" filtering, defaults to incomplete tasks
- **批量操作**：支持清空指定日期的所有任务
- **Batch Operations**: Supports clearing all tasks for a specific date

### 智能继承 / Smart Inheritance
- **自动移动**：插件加载时自动将历史未完成任务移动到今天（非复制）
- **Auto Move**: Automatically moves incomplete historical tasks to today on plugin load (not copy)
- **定时任务**：每天凌晨1点自动将历史未完成任务移动到今天
- **Scheduled Task**: Automatically moves incomplete historical tasks to today at 1 AM daily
- **避免重复**：智能检测已移动的任务，历史任务移动后自动从原日期删除
- **Avoid Duplicates**: Smart detection of moved tasks, historical tasks are removed from original date after moving

### 搜索功能 / Search
- **关键词搜索**：支持搜索任务内容、链接、截止日期
- **Keyword Search**: Supports searching task content, links, and due dates
- **实时过滤**：输入即搜索，实时更新任务列表
- **Real-time Filtering**: Search as you type, real-time task list updates
- **不区分大小写**：搜索时忽略大小写
- **Case Insensitive**: Ignores case when searching

### 导出功能 / Export
- **日期范围导出**：支持选择开始日期和结束日期导出
- **Date Range Export**: Supports selecting start and end dates for export
- **CSV格式**：导出为CSV格式，Excel可直接打开
- **CSV Format**: Export to CSV format, can be opened directly in Excel
- **完整信息**：导出内容包括日期、任务内容、状态、截止日期、链接、创建时间
- **Complete Info**: Export includes date, task content, status, due date, link, and creation time
- **中文支持**：完美支持中文内容导出
- **Chinese Support**: Perfect support for Chinese content export

## 安装步骤 / Installation

1. **下载插件**：将本项目文件夹复制到 Obsidian 库的 `.obsidian/plugins/` 目录下
   **Download Plugin**: Copy this project folder to your Obsidian vault's `.obsidian/plugins/` directory
2. **启用插件**：在 Obsidian 设置 → 社区插件中启用「Todo List for Obsidian」
   **Enable Plugin**: Enable "Todo List for Obsidian" in Obsidian Settings → Community plugins
3. **重启 Obsidian**：重启后即可使用
   **Restart Obsidian**: Restart to use the plugin

## 使用指南 / Usage Guide

### 打开面板 / Open Panel
- 点击 Obsidian 左侧边栏的「待办看板」图标（勾选框图标）打开待办面板
- Click the "Todo Kanban" icon (checkbox icon) in Obsidian's left sidebar to open the todo panel

### 添加任务 / Add Task
1. 在底部输入框中输入任务内容 / Enter task content in the bottom input box
2. 可选：填写链接（支持任意URL） / Optional: Fill in link (supports any URL)
3. 可选：选择截止日期 / Optional: Select due date
4. 按 Enter 键或点击「添加」按钮添加任务 / Press Enter or click "Add" button to add task

### 编辑任务 / Edit Task
- 双击任务内容区域，弹出编辑对话框 / Double-click task content area to open edit dialog
- 可修改任务内容、链接、截止日期 / Can modify task content, link, due date
- 点击「保存」保存修改 / Click "Save" to save changes

### 筛选与搜索 / Filter & Search
1. **日期筛选**：在顶部下拉框中选择日期范围 / **Date Filter**: Select date range in top dropdown
2. **关键词搜索**：在搜索框中输入关键词实时搜索 / **Keyword Search**: Enter keywords in search box for real-time search
3. **状态筛选**：在每个日期分组下选择「未完成」或「已完成」 / **Status Filter**: Select "Incomplete" or "Completed" under each date group

### 导出任务 / Export Tasks
1. 点击顶部「导出Excel」按钮 / Click "Export Excel" button at top
2. 选择开始日期和结束日期 / Select start and end dates
3. 点击「导出」下载CSV文件 / Click "Export" to download CSV file

### 其他操作 / Other Operations
- **标记完成**：点击任务左侧的勾选框 / **Mark Complete**: Click checkbox on left side of task
- **删除任务**：点击任务右侧的「×」按钮 / **Delete Task**: Click "×" button on right side of task
- **移动到今天**：历史任务可点击「→今天」按钮移动到今天 / **Move to Today**: Historical tasks can click "→Today" button to move to today
- **清空日期任务**：点击日期标题右侧的「清空」按钮 / **Clear Date Tasks**: Click "Clear" button on right side of date title

## 数据存储 / Data Storage

任务数据存储在 Obsidian 库根目录的 `.obsidian/plugins/todo_kanban/tasks.json` 文件中，采用 JSON 格式存储，确保数据安全可靠。

Task data is stored in JSON format in `.obsidian/plugins/todo_kanban/tasks.json` in your Obsidian vault root directory, ensuring data safety and reliability.

### 数据结构 / Data Structure
```json
{
  "tasks": [
    {
      "date": "2026-03-08",
      "createTime": "2026-03-08 10:00",
      "tasksList": [
        {
          "taskId": "unique-id",
          "content": "任务内容 / Task content",
          "completed": false,
          "createAt": "2026-03-08 10:00",
          "link": "https://example.com",
          "dueDate": "2026-03-10"
        }
      ]
    }
  ]
}
```

## 技术说明 / Technical Notes

- 基于 Obsidian 官方 API 开发 / Based on Obsidian official API
- 使用 JavaScript 编写，无编译依赖 / Written in JavaScript, no compilation dependencies
- 适配 Obsidian 浅色/深色主题 / Adapts to Obsidian light/dark themes
- 无第三方依赖，纯原生实现 / No third-party dependencies, pure native implementation
- 支持 Obsidian v1.0.0 及以上版本 / Supports Obsidian v1.0.0 and above

## 性能要求 / Performance Requirements

- 插件启动时间 ≤ 100ms / Plugin startup time ≤ 100ms
- 历史任务数据量 ≤ 1000 条时无卡顿 / No lag with ≤ 1000 historical tasks
- 操作响应时间 ≤ 50ms / Operation response time ≤ 50ms

## 注意事项 / Notes

- 所有数据仅存储在本地，无网络请求 / All data stored locally only, no network requests
- 插件完全免费开源，无付费功能 / Plugin is completely free and open source, no paid features
- 请定期备份 `.obsidian/plugins/todo_kanban/tasks.json` 文件，以防数据丢失 / Please backup `.obsidian/plugins/todo_kanban/tasks.json` regularly to prevent data loss
- 历史未完成任务会在每天凌晨1点自动移动到今天 / Incomplete historical tasks are automatically moved to today at 1 AM daily

## 更新日志 / Changelog

### v1.0.2
- 新增：紧急任务置顶功能，截止日期前一天开始自动置顶显示，带红色边框和"紧急"标识
- Added: Urgent task pinning feature, tasks are automatically pinned one day before due date with red border and "urgent" badge
- 新增：编辑截止日期后自动重新排序任务列表
- Added: Auto re-sort task list after editing due date
- 新增：任务列表支持滚动查看，任务过多时可滚动查看下方任务
- Added: Task list supports scrolling when there are many tasks
- 优化：历史未完成任务自动移动到今天（改为移动而非复制，避免重复）
- Improved: Historical incomplete tasks are moved to today instead of copied
- 移除：手动"→今天"按钮（已有自动移动功能）
- Removed: Manual "→Today" button (replaced by auto-move feature)

### v1.0.1
- 新增：任务输入框支持自适应高度，根据内容自动增大缩小
- Added: Task input box supports auto-resize based on content
- 新增：任务支持拖拽排序，可自由调整任务顺序
- Added: Tasks support drag-to-reorder for adjusting task order

### v1.0.0
- 初始版本发布 / Initial release
- 支持当日待办和历史待办管理 / Support for daily and historical todo management
- 支持任务链接和截止日期 / Support for task links and due dates
- 支持关键词搜索 / Support for keyword search
- 支持CSV导出 / Support for CSV export
- 支持双击编辑 / Support for double-click editing
- 支持历史任务自动继承 / Support for automatic inheritance of historical tasks
