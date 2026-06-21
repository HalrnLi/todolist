# TodoList Obsidian 插件 — 代码改动评审清单

> 本文档供其他 AI / 评审者审查本次改动使用。每项改动包含：问题背景、方案、涉及文件、评审关注点。
> 评审时请重点关注**运行时逻辑正确性**，尤其是改动 3（写并发锁）的链式 reject 问题 —— 项目无测试框架，仅通过 `npm run build` 验证了打包成功，未在真实 Obsidian 环境做运行时验证。

---

## 项目背景

- Obsidian 插件，看板式待办管理，CommonJS 纯 JS（非 TS）
- 入口 `main.js` → `plugin.js`，按 `services/` `views/` `modals/` `utils/` `models.js` 分模块
- 数据存于 `tasks.json`，内存维护 `taskIdIndex`/`dateIndex` 两套索引
- 无测试框架，验证手段仅为 `node esbuild.config.mjs production` 能否打包成功

---

## 改动 1：删除按钮双重事件绑定（Bug）

**问题**：`TodoView.createTaskCard` 内给删除按钮单独绑了 `click` 监听器调用 `deleteTask`；同时 `setupEventDelegation` 的容器级事件委托也在监听 `.todo-delete-button` 调用 `handleTaskDelete`。点击一次 → 两个监听器都触发 → `deleteTask` 被调用两次。

**方案**：移除 `createTaskCard` 内的冗余监听器，统一走容器委托路径（`handleTaskDelete` 更完整，会清理空日期组）。

**涉及文件**：`views/TodoView.js`

**评审关注点**：
- 委托版本判断 `e.target.classList.contains('todo-delete-button')` 是否可靠（事件目标是否一定是按钮本身而非其子元素？按钮内当前无子元素，但需确认）
- 是否还有其他卡片内元素也同时存在"逐元素绑定 + 委托"的双重绑定

---

## 改动 2：数据备份与损坏恢复机制（数据安全）

**问题**：
- `backupTasks()` 方法存在但**从未被调用**，导致 JSON 损坏时无备份可恢复
- `loadTasks` 的 catch 分支直接重置为空数据 → 用户全部任务丢失
- `migrateData` 遇到脏数据（如 `tasksList` 非数组）会崩溃，且直接 mutate 入参 `oldData`

**方案**：
1. `migrateData` 加固：先做结构校验（过滤掉非对象/无 `tasksList` 的脏条目），改为返回新对象不 mutate 入参；校验失败抛错
2. `loadTasks` 成功加载后调用 `backupTasks()` 建立备份基线
3. JSON 解析/迁移失败时，新增 `_recoverFromBackup()` 从 `tasks-backup.json` 恢复，并用 `_writeRaw()` 覆盖损坏主文件
4. 备份恢复失败才用空数据兜底

**涉及文件**：`plugin.js`（`migrateData` / `loadTasks` / 新增 `_recoverFromBackup` / `_writeRaw` / 改 `backupTasks` 注释）

**评审关注点**：
- 备份在每次 `loadTasks` 成功后都会刷新，是否会让备份"污染"成与主文件相同的状态（即主文件损坏时备份可能也已损坏，因为是上一次启动写的）？这是否削弱了恢复价值？
- `_recoverFromBackup` 内对备份再次调用 `migrateData`，若备份本身是迁移失败的脏数据，会再次抛错 → 被 catch 返回 null → 兜底空数据。链路是否合理？
- `migrateData` 改成返回新对象后，原"直接修改 oldData.version"的副作用消失，是否有其他调用方依赖了原 mutation 行为？（确认：`migrateData` 仅被 `loadTasks` 调用）

---

## 改动 3：`saveTasks` 写并发保护（数据安全）

**问题**：用户快速连续操作（拖拽 + 完成 + 定时器触发自动继承）时，多个 `saveTasks` 的 `await write` 可能交错，后写覆盖先写。Obsidian `adapter.write` 不保证原子性。

**方案**：引入 `_saveChain = Promise.resolve()`，每次 `saveTasks` 把写操作 `.then()` 追加到链尾，返回该链，保证写串行化。

**涉及文件**：`plugin.js`（constructor 初始化 `_saveChain` + 重写 `saveTasks`）

**评审关注点**：
- ⚠️ **这是最需要重点评审的改动**。串行化后，`saveTasks` 写入的是 `this.tasksData` 的**当前值**而非调用时的快照。由于调用方（如 `addTask`/`deleteTask`/`updateTask`）在 `await saveTasks()` 前就已同步修改 `this.tasksData`，多个并发修改会在同一对象上叠加。链上排到执行时，写入的是"所有叠加修改后的最新状态"——这在大多数场景正确（因为修改是幂等叠加的），但需确认是否存在"调用方期望只持久化自己那次修改"的场景。
- 链上某次写失败抛错，会 reject 整个链吗？当前实现用 `throw error`，后续 `.then` 链若 reject 会导致下一次 `saveTasks` 的 `.then` 不执行（因为链已 reject）。**这是潜在 bug**：一次写失败后，后续所有写都会被跳过。需评审是否需要在链上加 `.catch` 兜底以保持链存活。
- `loadTasks` 里的 `_writeRaw`（恢复用）和 `saveTasks` 是否需要共享同一把锁？

---

## 改动 4：提醒倒计时定期刷新（体验）

**问题**：提醒图标的 `⏰ X 分钟后提醒` title 在创建/渲染时算死，不会随时间流逝更新，用户看到的是静态值。

**方案**：`TodoView.onOpen` 末尾启动 `_reminderTicker`（`setInterval` 30s），调用 `_refreshReminderIcons()` 仅更新图标 title（不全量重渲染）；`onClose` 清理 `clearInterval`。

**涉及文件**：`views/TodoView.js`

**评审关注点**：
- 30s 间隔是否合理（倒计时以分钟为单位，30s 足够）
- `_refreshReminderIcons` 用 `querySelectorAll('.todo-reminder-icon')` 遍历，在大任务量下是否有性能问题（每 30s 一次，可接受）
- 定时器是否会在视图未真正显示（如 leaf 后台）时也空跑？是否会与 `renderTasks` 的全量重建产生竞争（renderTasks 删除旧图标、ticker 同时操作）？ticker 操作的是 DOM 节点引用，若节点已被 renderTasks 移除，`icon.remove()` 是安全的，但需确认无报错。

---

## 改动 5：删除死代码 `updateTaskCard`

**问题**：`TodoView.updateTaskCard` 方法定义了但全局无调用（实际用的是 `updateCardContent`）。

**方案**：删除整个方法（-44 行）。

**涉及文件**：`views/TodoView.js`

**评审关注点**：确认确实无调用（已 grep 验证仅定义处）。

---

## 改动 6：通知权限懒请求（体验/隐私）

**问题**：`ReminderService` 构造函数立即调 `Notification.requestPermission()`，插件一加载就弹权限框，此时用户可能还没用过提醒功能。

**方案**：构造函数移除 `_requestPermission()` 调用，改为在 `setReminder`（用户真正设置提醒时）才请求。

**涉及文件**：`services/ReminderService.js`

**评审关注点**：
- 若用户在权限为 `default` 时设置提醒，`requestPermission` 是异步的，首次提醒可能因权限未及时授予而走 Notice fallback。这是可接受的降级，但需确认 `_notify` 的 fallback 逻辑健壮。
- `_requestPermission` 方法保留为实例方法（被 `setReminder` 调用），命名上是否合适。

---

## 改动 7：提取 `isLeapYear` helper（代码质量）

**问题**：`models.js` 的 `isUrgentTask` 中闰年判断逻辑写了两次（验证日期有效性时一次，计算前一天日期时一次），重复。

**方案**：提取 `isLeapYear(year)` 和 `getDaysInMonth(year, month)` 两个模块级 helper，消除重复，简化 `isUrgentTask`。

**涉及文件**：`models.js`

**评审关注点**：
- 重构后逻辑是否与原逻辑等价（原代码验证阶段用 `daysInMonth[dueMonth-1]` + 闰年特判，新代码用 `getDaysInMonth`，应等价）
- `DAYS_IN_MONTH` 作为模块级常量是否合适
- 重构后未导出 `isLeapYear`/`getDaysInMonth`（仅供模块内部用），是否符合预期

---

## 改动 8：`Notice` require 提到文件顶部（代码质量）

**问题**：`plugin.js` 在构造函数内 `new ErrorHandler(require('obsidian').Notice)` 内联 require，不如顶部统一管理，且若 require 失败整个构造崩溃。

**方案**：顶部 `const { Plugin, Notice } = require('obsidian')`，构造函数改用 `new ErrorHandler(Notice)`。

**涉及文件**：`plugin.js`

**评审关注点**：纯风格改动，无行为变化。

---

## 改动 9：`confirm()` 改为 Obsidian Modal（兼容性）

**问题**：`TodoView` 用浏览器原生 `confirm()` 做清空确认，在 Obsidian/Electron（尤其移动端）可能被拦截或样式突兀。

**方案**：新建 `modals/ConfirmModal.js`（继承 `Modal`，支持 `title`/`message`/`confirmText`/`cancelText`/`onConfirm`/`onCancel`），替换 `TodoView` 中清空日期组的 `confirm` 调用。

**涉及文件**：新建 `modals/ConfirmModal.js`、`views/TodoView.js`

**评审关注点**：
- `ConfirmModal.onClose` 用 `this._confirmed` 标志区分"点确认关闭"还是"ESC/点遮罩关闭"，后者触发 `onCancel`。逻辑是否正确（确认按钮 click 会先设 `_confirmed=true` 再 close）
- 是否还有其他 `confirm()` 残留（已 grep 确认仅剩注释提及）
- `ReminderService._notify` 里的 `window.open`（点击通知打开链接）**有意保留**，因为是 `notification.onclick` 回调内的标准用法，非拦截风险点。是否同意此判断？

---

## 改动 10：同步文档与构建脚本（一致性）

**问题**：
- `package.json` 的 `scripts` 仍是 `tsc`/`tsc -watch`，但实际打包用 esbuild，没有 esbuild 命令
- `CLAUDE.md` 描述与代码不符：称"批量渲染 batches of 20"（实际是一次性 fragment）、称"拖拽逐卡片绑定"（实际是容器委托）

**方案**：
- `package.json`：`build` → `node esbuild.config.mjs production`，`dev` → `node esbuild.config.mjs`，新增 `build:check` → `tsc`
- `CLAUDE.md`：修正渲染、事件委托、提醒排序、确认弹窗的描述

**涉及文件**：`package.json`、`CLAUDE.md`

**评审关注点**：
- `dev` 从 `tsc -watch` 改为 esbuild watch，是否会丢失类型检查能力（已用 `build:check` 保留 tsc，但 dev 不再含类型检查）
- CLAUDE.md 新增的"reminder ticker 30s"描述是否与代码一致

---

## 未处理项（供参考，非本次改动）

1. **#2 `handleTaskComplete` 竞态**：乐观更新用旧 task 引用 + appendChild 移到底部，与 `renderTasks` 排序短暂不一致。未改（影响小，彻底修复需重构乐观更新）。
2. **#8 CSV `-` 转义过度**：`/^[=+\-@\t]/` 会把 `-` 开头单元格多余转义。未改（不影响正确性）。
3. **#14 author 不一致**：`manifest.json` 是 `HarlanLi`，`package.json` 是 `lilingtao`。未改（属个人信息，待用户确认）。

---

## 整体验证

- `npm run build`（`node esbuild.config.mjs production`）→ 退出码 0 ✅
- 无单元测试/集成测试可跑（项目无测试框架）
- **未在真实 Obsidian 环境手动验证运行时行为**，仅通过静态构建验证语法/打包正确性。评审时请重点关注运行时逻辑正确性，尤其是改动 3（写并发锁）的链式 reject 问题。
