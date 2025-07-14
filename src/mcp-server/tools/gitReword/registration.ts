import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolResult,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { ErrorHandler } from "../../../utils/index.js";
import { logger } from "../../../utils/index.js";
import { requestContextService } from "../../../utils/index.js";
import { BaseErrorCode } from "../../../types-global/errors.js";
import {
  rewordGitCommit,
  GitRewordInput,
  GitRewordInputSchema,
  GitRewordResult,
} from "./logic.js";

// --- State Accessors ---
export type GetWorkingDirectoryFn = (
  sessionId: string | undefined,
) => string | undefined;
export type GetSessionIdFn = (
  context: Record<string, any>,
) => string | undefined;

let _getWorkingDirectory: GetWorkingDirectoryFn | undefined;
let _getSessionId: GetSessionIdFn | undefined;

export function initializeGitRewordStateAccessors(
  getWdFn: GetWorkingDirectoryFn,
  getSidFn: GetSessionIdFn,
): void {
  _getWorkingDirectory = getWdFn;
  _getSessionId = getSidFn;
  logger.info("State accessors initialized for git_reword tool registration.");
}

const TOOL_NAME = "git_reword";
const TOOL_DESCRIPTION = `Rewords the message of the most recent commit (HEAD) in the Git repository. Returns the reword result as a JSON object.

**Commit Message Guidance:**
Write clear, concise commit messages using the Conventional Commits format: \`type(scope): subject\`.\n- \`type\`: feat, fix, docs, style, refactor, test, chore, etc.\n- \`(scope)\`: Optional context (e.g., \`auth\`, \`ui\`, filename).\n- \`subject\`: Imperative, present tense description (e.g., \"add login button\", not \"added login button\").\n- Subject (Commit Title) line should be concise and limited to 72 characters. Emojis can also be used in the subject line for visual cues (e.g., ✨ feat: add new feature).\n
**Important Note:** This tool only supports rewording the *last* commit (HEAD). To reword an older commit, you must use \`git rebase -i <commit-before-target>\` manually in your terminal.

**Tool Options & Behavior:**
- The \`path\` defaults to the session's working directory unless overridden.
`;

export const registerGitRewordTool = async (
  server: McpServer,
): Promise<void> => {
  if (!_getWorkingDirectory || !_getSessionId) {
    throw new Error(
      "State accessors for git_reword must be initialized before registration.",
    );
  }

  const operation = "registerGitRewordTool";
  const context = requestContextService.createRequestContext({ operation });

  await ErrorHandler.tryCatch(
    async () => {
      server.tool<typeof GitRewordInputSchema.shape>(
        TOOL_NAME,
        TOOL_DESCRIPTION,
        GitRewordInputSchema.shape,
        async (validatedArgs, callContext): Promise<CallToolResult> => {
          const toolOperation = "tool:git_reword";
          const requestContext = requestContextService.createRequestContext({
            operation: toolOperation,
            parentContext: callContext,
          });

          const sessionId = _getSessionId!(requestContext);

          const getWorkingDirectoryForSession = () => {
            return _getWorkingDirectory!(sessionId);
          };

          const logicContext = {
            ...requestContext,
            sessionId: sessionId,
            getWorkingDirectory: getWorkingDirectoryForSession,
          };

          logger.info(`Executing tool: ${TOOL_NAME}`, logicContext);

          return await ErrorHandler.tryCatch<CallToolResult>(
            async () => {
              const rewordResult: GitRewordResult = await rewordGitCommit(
                validatedArgs as GitRewordInput,
                logicContext,
              );

              const resultContent: TextContent = {
                type: "text",
                text: JSON.stringify(rewordResult, null, 2),
                contentType: "application/json",
              };

              if (rewordResult.success) {
                logger.info(
                  `Tool ${TOOL_NAME} executed successfully, returning JSON`,
                  logicContext,
                );
              } else {
                logger.info(
                  `Tool ${TOOL_NAME} completed with non-fatal condition (e.g., nothing to reword), returning JSON`,
                  logicContext,
                );
              }
              return { content: [resultContent] };
            },
            {
              operation: toolOperation,
              context: logicContext,
              input: validatedArgs,
              errorCode: BaseErrorCode.INTERNAL_ERROR,
            },
          );
        },
      );

      logger.info(`Tool registered: ${TOOL_NAME}`, context);
    },
    { operation, context, critical: true },
  );
}; 
