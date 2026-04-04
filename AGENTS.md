# Agent Guidelines for TodoList Obsidian Plugin

This is an Obsidian plugin written in JavaScript for kanban-style todo management.

## Project Structure

```
.
├── main.js          # Main plugin code (single file, ~1500 lines)
├── manifest.json    # Plugin manifest
├── package.json     # Dependencies
├── styles.css       # UI styles (~700 lines)
└── README.md        # Documentation (bilingual: EN/CN)
```

## Build Commands

```bash
# Install dependencies
npm install

# Development - watch mode
npm run dev        # Runs: tsc -watch

# Production build
npm run build      # Runs: tsc
```

**Note:** This project uses JavaScript (not TypeScript). The TypeScript compiler is used only for type checking. There are no actual test files or test commands in this project.

## Code Style Guidelines

### Language & Comments
- **Bilingual documentation**: Keep README.md in both English and Chinese
- Comments can be in Chinese or English - follow existing bilingual style
- User-facing strings in Chinese (UI labels, alerts, etc.)

### Module System
- Use CommonJS: `const { App, Plugin } = require('obsidian');`
- Node.js built-ins: `const fs = require('fs');`
- Export at end: `module.exports = MyPlugin;`

### Naming Conventions
- **Classes**: PascalCase (e.g., `TodoKanbanPlugin`, `SecurityService`)
- **Methods/Functions**: camelCase (e.g., `generateUUID`, `formatDate`)
- **Constants**: UPPER_SNAKE_CASE for true constants (e.g., `PRIORITY.HIGH`)
- **Variables**: camelCase
- **File naming**: kebab-case (already established)

### CSS Conventions
- Use Obsidian CSS variables for theming:
  - `--background-primary`, `--background-secondary`
  - `--text-primary`, `--text-secondary`, `--text-muted`
  - `--interactive-accent`
  - `--background-modifier-border`
- Class prefix: `todo-` (e.g., `.todo-view-container`, `.todo-input`)

### Error Handling
```javascript
try {
  // operation
} catch (error) {
  ErrorHandler.handle(error, 'context description');
}
```

### Security Pattern
- Always sanitize user input via `SecurityService`:
  - `SecurityService.sanitizeInput(text)` - for display
  - `SecurityService.validateTaskContent(content)` - for task validation
  - `SecurityService.sanitizeLink(link)` - for URLs

### Date Handling
- Use local time (not UTC): `formatDate()`, `formatDateTime()`
- Date format: `YYYY-MM-DD`
- DateTime format: `YYYY-MM-DD HH:MM`

### Event Cleanup
- Use `AbortController` for event listener cleanup in views
- Clean up in `onClose()`: `this.abortController.abort()`

## Architecture Patterns

### Plugin Structure
```javascript
class MyPlugin extends Plugin {
  async onload() { /* initialization */ }
  onunload() { /* cleanup */ }
}
```

### View Structure
```javascript
class MyView extends ItemView {
  constructor(leaf, plugin) { /* setup */ }
  getViewType() { return 'unique-view-id'; }
  async onOpen() { /* render */ }
  async onClose() { /* cleanup */ }
}
```

### Modal Pattern
```javascript
class MyModal extends Modal {
  onOpen() { /* build UI */ }
  onClose() { /* cleanup */ }
}
```

## Key Dependencies
- `obsidian`: Obsidian API (latest)
- Node.js built-ins: `fs`, `path`
- No external runtime dependencies

## Important Notes

1. **No tests**: This project has no test framework configured
2. **Single-file architecture**: Main logic is in `main.js`
3. **XSS protection**: Always use `SecurityService` for user input
4. **Performance**: Keep operations under 50ms response time
5. **Data storage**: JSON file at `.obsidian/plugins/todo_kanban/tasks.json`
6. **Obsidian API**: Reference https://docs.obsidian.md for API usage
