# Git Reword Tool Examples

The `git_reword` tool allows you to change commit messages in Git repositories. It supports two scenarios:

1. **Rewording the last commit (HEAD)** - Uses `git commit --amend`
2. **Rewording older commits** - Provides detailed instructions for interactive rebase

## Basic Usage

### Rewording the Last Commit (HEAD)

```json
{
  "tool": "git_reword",
  "arguments": {
    "newMessage": "feat: add user authentication system"
  }
}
```

This will directly reword the most recent commit using `git commit --amend`.

### Rewording a Specific Commit

```json
{
  "tool": "git_reword",
  "arguments": {
    "commitHash": "80e2f25",
    "newMessage": "fix: resolve authentication bug in login flow"
  }
}
```

For older commits, the tool will return detailed instructions for performing an interactive rebase.

## Example Responses

### Successful HEAD Reword

```json
{
  "success": true,
  "message": "Commit message reworded successfully.",
  "originalMessage": "add auth",
  "newMessage": "feat: add user authentication system",
  "hash": "a1b2c3d4e5f6..."
}
```

### Older Commit Reword (Requires Manual Steps)

```json
{
  "success": false,
  "message": "Rewording commit 80e2f25 requires an interactive rebase.",
  "originalMessage": "fix login bug",
  "newMessage": "fix: resolve authentication bug in login flow",
  "hash": "80e2f25",
  "rebaseInstructions": "To reword commit 80e2f25, run the following commands:\n\n1. Start interactive rebase: git -C \"/path/to/repo\" rebase -i 80e2f25^\n2. In the editor, change 'pick' to 'reword' for commit 80e2f25\n3. Save and close the editor\n4. When the rebase stops for the reword, the commit message editor will open\n5. Replace the message with: fix: resolve authentication bug in login flow\n6. Save and close the editor\n7. The rebase will continue automatically\n\nAlternatively, you can use this one-liner (but be careful):\necho 'fix: resolve authentication bug in login flow' > /tmp/new_message && git -C \"/path/to/repo\" rebase -i 80e2f25^ --exec 'git commit --amend -F /tmp/new_message'"
}
```

## Best Practices

1. **Use Conventional Commits format** for better commit history organization
2. **Be specific** about what the commit changes
3. **Keep messages concise** but descriptive
4. **Test rebase instructions** in a safe environment before applying to important branches

## Error Handling

The tool handles various error scenarios:

- **Invalid commit hash**: Returns validation error
- **Not a Git repository**: Returns NOT_FOUND error
- **Root commit**: Cannot reword root commit (no parent)
- **No changes**: Returns validation error for HEAD amendments

## Security Notes

- All paths are sanitized to prevent command injection
- Commit messages are properly escaped
- Temporary files are cleaned up automatically
- The tool validates commit existence before proceeding 
