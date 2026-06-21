```markdown
# API-Meter Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development practices and conventions used in the API-Meter JavaScript codebase. You'll learn how to structure files, write imports/exports, commit code, and organize tests according to the repository's standards. This guide is ideal for contributors seeking to maintain consistency and quality in API-Meter.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `apiMeter.js`, `userRoutes.js`

### Import Style
- Use **absolute imports** (not relative paths).
  - Example:
    ```javascript
    import { fetchData } from 'utils/fetchData';
    ```

### Export Style
- Use **named exports** (not default).
  - Example:
    ```javascript
    // In utils/fetchData.js
    export function fetchData() { ... }
    ```

    ```javascript
    // In another file
    import { fetchData } from 'utils/fetchData';
    ```

### Commit Messages
- Follow **conventional commit** style.
- Use the `fix` prefix for bug fixes.
- Keep commit messages concise (average ~39 characters).
  - Example:
    ```
    fix: handle null response in fetchData
    ```

## Workflows

### Code Commit Workflow
**Trigger:** When committing any code changes  
**Command:** `/commit`

1. Stage your changes with `git add`.
2. Write a commit message using the conventional commit format.
   - Use prefixes like `fix` for bug fixes.
   - Example: `fix: handle null response in fetchData`
3. Commit your changes with `git commit -m "<message>"`.
4. Push to the repository.

### Testing Workflow
**Trigger:** Before pushing or merging code  
**Command:** `/test`

1. Identify or create test files matching the `*.test.*` pattern.
2. Run your test suite (framework is unknown; check project scripts or documentation).
3. Ensure all tests pass before proceeding.

## Testing Patterns

- Test files are named using the `*.test.*` pattern.
  - Example: `apiMeter.test.js`
- The testing framework is not specified; check for scripts in `package.json` or ask a maintainer.
- Place tests alongside the code they test or in a dedicated `tests` directory.

## Commands
| Command    | Purpose                                      |
|------------|----------------------------------------------|
| /commit    | Guide for making a conventional commit       |
| /test      | Steps for running and writing tests          |
```