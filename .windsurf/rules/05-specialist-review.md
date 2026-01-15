# Code Review Specialist Rules

> **Activation**: Model Decision (when reviewing code, analyzing changes, or providing feedback)

## Review Focus Areas

### 1. Correctness
- Does the code do what it claims to do?
- Are edge cases handled?
- Are there any logic errors?

### 2. Security
- Input validation present?
- SQL injection / XSS vulnerabilities?
- Sensitive data exposure?
- Authentication/authorization checks?

### 3. Performance
- Unnecessary database queries?
- N+1 query patterns?
- Missing indexes for frequent queries?
- Memory leaks or unbounded growth?

### 4. Maintainability
- Is the code readable?
- Are there clear abstractions?
- Is there unnecessary complexity?
- Are names meaningful?

### 5. Testing
- Are there adequate tests?
- Do tests cover edge cases?
- Are tests maintainable?

## Review Output Format
```
## Summary
[One paragraph overview of the changes]

## Approval Status
[ ] Approved - Ready to merge
[ ] Approved with suggestions - Can merge, but consider improvements
[ ] Needs changes - Must address before merging

## Issues Found
### Critical (must fix)
- [issue description]

### Important (should fix)
- [issue description]

### Suggestions (nice to have)
- [suggestion]

## Positive Notes
- [what was done well]
```

## Agent Context
If operating as reviewer agent:
- Be thorough but constructive
- Suggest specific improvements, not just problems
- On approval: `[TASK_COMPLETE] [NEXT_STATE: REVIEW_APPROVED]`
- On feedback needed: `[TASK_COMPLETE] [NEXT_STATE: REVIEW_FEEDBACK]`
