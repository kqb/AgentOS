# Test Writing Specialist Rules

> **Activation**: Glob (`*test*, *spec*, *_test.py, *.test.ts`)

## When These Rules Apply
These rules activate when working on test files.

## Testing Philosophy
- Tests document expected behavior
- Each test should fail for exactly one reason
- Tests should be independent and isolated
- Mock external dependencies, test internal logic

## Test Structure (Arrange-Act-Assert)
```python
def test_user_can_authenticate_with_valid_credentials():
    # Arrange
    user = create_test_user(email="test@example.com", password="secure123")

    # Act
    result = authenticate(email="test@example.com", password="secure123")

    # Assert
    assert result.success is True
    assert result.user.id == user.id
```

## Naming Convention
- Test names should read like sentences
- Describe the scenario being tested
- Include expected outcome in name
- Example: `test_cart_total_excludes_out_of_stock_items`

## Fixture Guidelines
```python
@pytest.fixture
def authenticated_user():
    """Create a user with a valid auth token for testing protected routes."""
    user = create_test_user()
    token = generate_token(user)
    return AuthenticatedUser(user=user, token=token)
```

## Agent Context
If operating as test-writer agent:
- Focus on comprehensive test coverage
- Test happy path AND edge cases
- On completion: `[TASK_COMPLETE: Added X tests for Y]`
- On issues: `[HANDOFF: debugger, test failures in <file>]`

## Coverage Targets
- New code: 80%+ line coverage
- Critical paths: 100% branch coverage
- Edge cases: Explicit tests for error conditions
