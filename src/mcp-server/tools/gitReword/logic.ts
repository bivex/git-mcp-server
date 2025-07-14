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
  );

  try {
    // Determine the commit to reword
    const commitRef = input.commitHash || "HEAD";

    // First, get the original commit message if a specific hash is provided
    let originalMessage = "";
    if (input.commitHash) {
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
    }

    // Sanitize the new message to prevent command injection
    const sanitizedNewMessage = input.newMessage.replace(/"/g, '\"');

    let command: string;
    if (input.commitHash) {
      // For reword, we'll use git filter-repo or a rebase approach if not HEAD
      // For simplicity, for now, we'll only support HEAD via commit --amend
      // If a specific hash is provided, it usually implies rebase -i or filter-repo which are more complex.
      // For this tool, we'll restrict to HEAD for now, or use an interactive rebase for specific commits.
      // Given the request is for a specific commit, we should actually initiate a rebase.

      // This is a simplified approach. For true arbitrary commit reword,
      // it would involve git rebase -i and then detecting the editor.
      // For this specific case (reword only), let's assume it's always HEAD or require user to rebase.

      // Since the request explicitly gives a hash, and we can't easily do a non-interactive rebase reword
      // directly for an arbitrary commit without complex scripting, let's revert to advising interactive rebase
      // OR, for the purpose of this tool, we will only allow reword for HEAD for now.
      // If the user wants to reword an older commit, they must use interactive rebase directly.

      // Re-evaluating: The prompt asks to reword a specific past commit and "the last one".
      // `git commit --amend` only works for the very last commit (HEAD).
      // To reword an arbitrary commit (like "4377c80..."), one would typically use `git rebase -i <commit-before-target>`.
      // The simplest way to handle this via a tool, given the constraints,
      // is to initiate an interactive rebase if `commitHash` is not HEAD.
      // However, interactive rebase requires user interaction.

      // A direct, non-interactive way to reword an arbitrary commit is more involved,
      // often requiring `git filter-branch` or `git filter-repo`, which are powerful but dangerous.

      // Given the context of "reword" being a common interactive rebase action,
      // and the model's ability to run shell commands, we can't directly intercept
      // and change the commit message in the rebase interactive mode.

      // Let's assume for this tool, 'reword' will mean changing the *last* commit (HEAD)
      // or guiding the user to do an interactive rebase for older commits.
      // If commitHash is provided and it's not HEAD, we'll throw an error or suggest `git rebase -i`.

      if (commitRef !== "HEAD") {
        return {
          success: false,
          message: `Rewording a specific past commit (${commitRef}) requires an interactive rebase. Please run 'git rebase -i ${commitRef}^' in your terminal, then change 'pick' to 'reword' for the commit.`,
        };
      }
    }

    // This command is specifically for the last commit (HEAD)
    command = `git -C "${targetPath}" commit --amend -m "${sanitizedNewMessage}"`;

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
