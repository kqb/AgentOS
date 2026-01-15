# Code Standards

> **Activation**: Always On

## General Principles
- Prefer composition over inheritance
- Explicit is better than implicit
- Write self-documenting code with meaningful names
- Keep functions focused and under 50 lines

## Python Standards
- Python 3.11+ required
- Full type hints on all function signatures
- Async/await for all I/O operations
- Use `pathlib.Path` over `os.path`
- Prefer `dataclasses` or `pydantic` for data structures

## JavaScript/TypeScript Standards
- TypeScript preferred over JavaScript
- Strict mode enabled
- Use `const` by default, `let` when needed, never `var`
- Async/await over raw promises
- ES modules over CommonJS

## Documentation Standards
```python
def function_name(param: Type) -> ReturnType:
    """
    Brief description of what this does.

    This docstring is indexed by Windsurf for context retrieval.
    Include: purpose, key behaviors, edge cases.

    Args:
        param: Description of parameter

    Returns:
        Description of return value

    Raises:
        ExceptionType: When this happens
    """
```

## Error Handling
- Use custom exceptions for domain errors
- Never catch generic `Exception` unless re-raising
- Include context in error messages
- Log errors with full stack traces

## Testing Standards
- pytest for Python, Jest/Vitest for TypeScript
- Fixtures over setup/teardown methods
- Descriptive test names that explain the scenario
- One assertion per test when practical
- Mock external dependencies, not internal code
