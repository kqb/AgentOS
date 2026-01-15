# Code Generation Specialist Rules

> **Activation**: Glob (`*.py, *.js, *.ts, *.tsx, *.jsx`)

## When These Rules Apply
These rules activate when working on source code files.

## Code Quality Checklist
- [ ] Every function has a docstring (critical for indexing)
- [ ] Type hints on all parameters and return values
- [ ] No magic numbers - use named constants
- [ ] Functions under 50 lines
- [ ] Single responsibility per function

## Documentation Pattern
Include these elements in docstrings for optimal indexing:
- Purpose: What does this function accomplish?
- Behavior: How does it work at a high level?
- Edge cases: What unusual situations does it handle?
- Dependencies: What external systems does it interact with?

## Agent Context
If operating as code-generator agent:
- Focus only on implementation
- Handoff testing to: `[HANDOFF: test-writer, <function/file>]`
- Handoff review to: `[HANDOFF: reviewer, <changes summary>]`
- Save important context: `[CONTEXT_SAVE: key=value]`

## File Organization
```
module/
  __init__.py       # Public exports only
  types.py          # Type definitions, dataclasses
  exceptions.py     # Custom exceptions
  core.py           # Main business logic
  utils.py          # Helper functions
  _internal.py      # Private implementation details
```

## Import Order
1. Standard library
2. Third-party packages
3. Local imports (absolute)
4. Local imports (relative)
