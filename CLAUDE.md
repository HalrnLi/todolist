# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An Obsidian plugin for kanban-style todo management with daily task boards, historical task visualization, priority/tags support, drag-to-reorder, and CSV export. All data is stored locally in JSON. UI strings are in Chinese; README is bilingual EN/CN.

## Build Commands

```bash
# Install dependencies
npm install

# Type-check (project is JavaScript; tsc is used only for type checking)
npm run build        # tsc
npm run dev          # tsc -watch

# Bundle for distribution (uses esbuild, produces build/main.js)
node esbuild.config.mjs production

# Development watch (bundles to build/main.js with inline sourcemaps)
node esbuild.config.mjs
```

The `build/` directory contains the bundled output (`main.js`, `styles.css`, `manifest.json`). Copy the entire `build/` folder into `.obsidian/plugins/todo_kanban/` to install the plugin in Obsidian.

## Architecture

### Module Organization

The codebase is split into feature-based modules under the project root:

- `main.js` — Entry point. Simply re-exports `plugin.js`.
- `plugin.js` — Core `TodoKanbanPlugin` class extending Obsidian's `Plugin`. Owns the in-memory task data, file I/O, indexing, data migration, and daily auto-inherit timer.
- `views/TodoView.js` — Main UI view extending `ItemView`. Builds the DOM, handles all user interactions, filtering, sorting, drag-and-drop, and delegates data mutations back to the plugin.
- `models.js` — Pure utilities: UUID generation, `PRIORITY` constants, tag parsing (`#tag` syntax), urgent-task detection.
- `utils/date.js` — Date formatting helpers. **Critical:** uses local time (not UTC). Format is `YYYY-MM-DD`; datetime is `YYYY-MM-DD HH:MM`.
- `services/` — Cross-cutting concerns:
  - `SecurityService.js` — XSS sanitization, input validation, link protocol whitelisting (`http:`/`https:` only).
  - `ErrorHandler.js` — Wraps Obsidian `Notice` to show user-friendly error toasts.
  - `TimerManager.js` — Wraps `setTimeout` with automatic cleanup tracking.
- `modals/` — Obsidian `Modal` subclasses for editing tasks and exporting to CSV.
- `styles.css` — All UI styles. Uses Obsidian CSS variables for theming compatibility.

### Data Flow & Storage

Tasks are stored in a single JSON file at `.obsidian/plugins/todo_kanban/tasks.json` with this shape:

```json
{
  "version": "1.2.0",
  "tasks": [
    {
      "date": "2026-04-25",
      "createTime": "2026-04-25 10:00",
      "tasksList": [
        {
          "taskId": "uuid",
          "content": "task content #tag",
          "completed": false,
          "createAt": "2026-04-25 10:00",
          "link": "https://...",
          "dueDate": "2026-04-26",
          "priority": "high"
        }
      ]
    }
  ],
  "lastModified": "2026-04-25T10:00:00.000Z"
}
```

**Indexing:** `TodoKanbanPlugin` maintains two in-memory indexes rebuilt on every load/save:
- `taskIdIndex: Map<taskId, { date, task }>` — O(1) task lookups.
- `dateIndex: Map<date, dateTask>` — O(1) date-group lookups.

All mutating methods (`updateTask`, `deleteTask`, `moveTaskToToday`, etc.) operate through these indexes after validating the task exists.

**Auto-inheritance:** On plugin load and daily at 1 AM, incomplete tasks from past dates are moved (not copied) to today. Empty date groups are removed. `TimerManager` schedules the next 1 AM tick.

**Data migration:** `migrateData()` in `plugin.js` handles version upgrades (e.g., adding `priority` field when migrating from 1.1.0 to 1.2.0).

### Rendering & Performance

`TodoView.renderTasks()` drives the entire UI:

1. Filters by date range (today / 7 days / 30 days / week / all).
2. Applies search keyword, tag filter, and priority filter in a single pass.
3. Sorts date groups descending (newest first).
4. Renders via `renderTasksInBatches()` using `DocumentFragment` in batches of 20 with `setTimeout(0)` yield points to avoid blocking the main thread.

Within each date group, tasks are sorted:
- Incomplete before completed.
- Urgent tasks (due date is tomorrow or earlier) pinned at top.
- By priority order (high → medium → low → none).
- Tasks without due date before tasks with due date.
- Tasks with due date sorted ascending.

**Event handling:** `TodoView` uses `AbortController` to register all DOM event listeners. On `onClose()`, `abortController.abort()` removes them. Drag-and-drop events are attached per-card (not delegated) to restrict reordering within the same date group.

### Security Patterns

Always route user input through `SecurityService`:
- `SecurityService.validateTaskContent(content)` — throws if empty, >1000 chars, or contains HTML tags.
- `SecurityService.sanitizeInput(text)` — for DOM text insertion (escapes HTML).
- `SecurityService.sanitizeLink(link)` — validates URL protocol is `http:` or `https:`.

CSV export escapes cells to prevent formula-injection attacks (`=`, `+`, `-`, `@` prefixes are wrapped in quotes).

### CSS Conventions

- Class prefix: `todo-` (e.g., `.todo-card`, `.todo-input`).
- Use Obsidian CSS variables for theming: `--background-primary`, `--text-normal`, `--interactive-accent`, `--background-modifier-border`, etc.
- The plugin targets Obsidian v1.0.0+ and must work in both light and dark themes.

### Module System

- CommonJS only: `const { Plugin } = require('obsidian');`
- Node.js built-ins available: `path`, `fs` (via Obsidian/Electron).
- Export at end of file: `module.exports = MyClass;`.

## Important Constraints

- **No test framework** is configured. There are no test commands or test files.
- **No TypeScript source files.** The project is plain JavaScript; `tsc` is used only for type-checking against `obsidian` types.
- The bundled `build/main.js` is the artifact consumed by Obsidian. `esbuild.config.mjs` handles bundling and marks `obsidian`, `electron`, and CodeMirror packages as `external`.
- User-facing strings must remain in Chinese.
