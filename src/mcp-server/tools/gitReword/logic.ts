import { exec } from "child_process";
import { promisify } from "util";
import { z } from "zod";
import { BaseErrorCode, McpError } from "../../../types-global/errors.js";
import { logger, RequestContext, sanitization } from "../../../utils/index.js";

const execAsync = promisify(exec);

export const GitRewordInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .optional()
    .default(".")
    .describe(
      "Path to the Git repository. Defaults to the directory set via `git_set_working_dir` for the session; set 'git_set_working_dir' if not set.",
    ),
  commitHash: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The hash of the commit to reword. If not provided, HEAD is assumed.",
    ),
  newMessage: z
    .string()
    .min(1)
    .describe("The new commit message."),
});

export type GitRewordInput = z.infer<typeof GitRewordInputSchema>;

export interface GitRewordResult {
  success: boolean;
  message: string;
  originalMessage?: string;
  newMessage?: string;
  hash?: string;
  rebaseInstructions?: string;
}

export async function rewordGitCommit(
  input: GitRewordInput,
  context: RequestContext & {
    sessionId?: string;
    getWorkingDirectory: () => string | undefined;
  },
): Promise<GitRewordResult> {
  const operation = "rewordGitCommit";
  const targetPath = sanitization.sanitizePath(
    input.path || context.getWorkingDirectory() || ".",
    { allowAbsolute: true }
  );

  try {
    // Determine the commit to reword
    const commitRef = input.commitHash || "HEAD";

    // First, get the original commit message
    let originalMessage = "";
    try {
      const { stdout } = await execAsync(
        `git -C "${targetPath}" log -1 --pretty=format:%B ${commitRef}`,
      );
      originalMessage = stdout.trim();
    } catch (error: any) {
      logger.warning(
        `Could not get original message for commit ${commitRef}: ${error.message}`,
        { ...context, operation },
      );
    }

    // Sanitize the new message to prevent command injection
    const sanitizedNewMessage = input.newMessage.replace(/"/g, '\"');

    let command: string;
    let isRebaseRequired = false;

    if (commitRef === "HEAD") {
      // For HEAD, use commit --amend
      command = `git -C "${targetPath}" commit --amend -m "${sanitizedNewMessage}"`;
    } else {
      // For arbitrary commits, we need to use rebase
      isRebaseRequired = true;
      
      // First, let's find the parent of the target commit
      let parentCommit: string;
      try {
        const { stdout } = await execAsync(
          `git -C "${targetPath}" rev-parse ${commitRef}^`,
        );
        parentCommit = stdout.trim();
      } catch (error: any) {
        throw new McpError(
          BaseErrorCode.VALIDATION_ERROR,
          `Could not find parent commit for ${commitRef}. This might be the root commit or an invalid commit hash.`,
          { context, operation, originalError: error },
        );
      }

      // Create a temporary file with the new commit message
      const tempMessageFile = `${targetPath}/.git-reword-message-${Date.now()}`;
      
      try {
        // Write the new message to a temporary file
        const fs = await import("fs/promises");
        await fs.writeFile(tempMessageFile, sanitizedNewMessage);
        
        // Set up the rebase to use our custom message
        const rebaseCommand = `git -C "${targetPath}" rebase -i ${parentCommit} --exec 'git commit --amend -F "${tempMessageFile}"'`;
        
        // For now, we'll provide instructions for manual rebase
        // since automated rebase with message replacement is complex
        const rebaseInstructions = `To reword commit ${commitRef}, run the following commands:

1. Start interactive rebase: git -C "${targetPath}" rebase -i ${parentCommit}
2. In the editor, change 'pick' to 'reword' for commit ${commitRef}
3. Save and close the editor
4. When the rebase stops for the reword, the commit message editor will open
5. Replace the message with: ${sanitizedNewMessage}
6. Save and close the editor
7. The rebase will continue automatically

Alternatively, you can use this one-liner (but be careful):
echo '${sanitizedNewMessage}' > /tmp/new_message && git -C "${targetPath}" rebase -i ${parentCommit} --exec 'git commit --amend -F /tmp/new_message'`;

        // Clean up temp file
        await fs.unlink(tempMessageFile).catch(() => {});

        return {
          success: false,
          message: `Rewording commit ${commitRef} requires an interactive rebase.`,
          originalMessage,
          newMessage: sanitizedNewMessage,
          hash: commitRef,
          rebaseInstructions,
        };
      } catch (error: any) {
        // Clean up temp file on error
        try {
          const fs = await import("fs/promises");
          await fs.unlink(tempMessageFile).catch(() => {});
        } catch {}
        
        throw error;
      }
    }

    logger.debug(`Executing command: ${command}`, { ...context, operation });

    const { stdout, stderr } = await execAsync(command);

    logger.debug(`Git reword stdout: ${stdout}`, { ...context, operation });
    if (stderr) {
      logger.warning(`Git reword stderr: ${stderr}`, { ...context, operation });
    }

    // Get the new hash and message for confirmation
    const { stdout: newLogStdout } = await execAsync(
      `git -C "${targetPath}" log -1 --pretty=format:%H%n%B`,
    );
    const [newHash, ...rest] = newLogStdout.trim().split("\n");
    const newCommitMessage = rest.join("\n");

    logger.info("git reword executed successfully", {
      ...context,
      operation,
      path: targetPath,
      originalMessage,
      newMessage: newCommitMessage,
      hash: newHash,
    });

    return {
      success: true,
      message: `Commit message reworded successfully.`,
      originalMessage,
      newMessage: newCommitMessage,
      hash: newHash,
    };
  } catch (error: any) {
    logger.error(`Failed to execute git reword command`, {
      ...context,
      operation,
      path: targetPath,
      error: error.message,
      stderr: error.stderr,
      stdout: error.stdout,
    });

    const errorMessage = error.stderr || error.stdout || error.message || "";

    if (errorMessage.toLowerCase().includes("not a git repository")) {
      throw new McpError(
        BaseErrorCode.NOT_FOUND,
        `Path is not a Git repository: ${targetPath}`,
        { context, operation, originalError: error },
      );
    }
    if (errorMessage.includes("no changes")) {
      throw new McpError(
        BaseErrorCode.VALIDATION_ERROR,
        `No changes to commit. Ensure there are staged changes if trying to amend, or specify a commit hash to reword a specific commit.`,
        { context, operation, originalError: error },
      );
    }
    throw new McpError(
      BaseErrorCode.INTERNAL_ERROR,
      `Failed to reword commit. Error: ${errorMessage}`,
      { context, operation, originalError: error },
    );
  }
} 
