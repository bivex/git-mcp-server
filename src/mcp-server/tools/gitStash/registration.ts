import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolResult,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { BaseErrorCode } from "../../../types-global/errors.js"; // Direct import for types-global
import {
  ErrorHandler,
  logger,
  requestContextService,
} from "../../../utils/index.js"; // logger (./utils/internal/logger.js), ErrorHandler (./utils/internal/errorHandler.js), requestContextService (./utils/internal/requestContext.js)
// Import the final schema and types for handler logic
// Import the BASE schema separately for registration shape
import {
  GitStashBaseSchema,
  GitStashInput,
  gitStashLogic,
  GitStashResult,
} from "./logic.js";

// --- State Accessors ---
/** Type definition for the function that gets the working directory for a session */
export type GetWorkingDirectoryFn = (
  sessionId: string | undefined,
) => string | undefined;
/** Type definition for the function that gets the session ID from the context */
export type GetSessionIdFn = (
  context: Record<string, any>,
) => string | undefined;

let _getWorkingDirectory: GetWorkingDirectoryFn | undefined;
let _getSessionId: GetSessionIdFn | undefined;

/**
 * Initializes the state accessors needed by the git_stash tool registration.
 * @param getWdFn - Function to get the working directory for a session.
 * @param getSidFn - Function to get the session ID from context.
 */
export function initializeGitStashStateAccessors(
  getWdFn: GetWorkingDirectoryFn,
  getSidFn: GetSessionIdFn,
): void {
  _getWorkingDirectory = getWdFn;
  _getSessionId = getSidFn;
  logger.info("State accessors initialized for git_stash tool registration.");
}

const TOOL_NAME = "git_stash";
const TOOL_DESCRIPTION =
  "Manages stashed changes in the working directory. Supports listing stashes, applying/popping specific stashes (with conflict detection), dropping stashes, and saving current changes to a new stash with an optional message. Returns results as a JSON object.";

/**
 * Registers the git_stash tool with the MCP server.
 *
 * @param {McpServer} server - The McpServer instance to register the tool with.
 * @returns {Promise<void>}
 * @throws {Error} If registration fails or state accessors are not initialized.
 */
export const registerGitStashTool = async (
  server: McpServer,
): Promise<void> => {
  if (!_getWorkingDirectory || !_getSessionId) {
    throw new Error(
      "State accessors for git_stash must be initialized before registration.",
    );
  }

  const operation = "registerGitStashTool";
  const context = requestContextService.createRequestContext({ operation });

  await ErrorHandler.tryCatch(
    async () => {
      // Register the tool using the *base* schema's shape for definition
      server.tool<typeof GitStashBaseSchema.shape>( // Use BASE schema shape here
        TOOL_NAME,
        TOOL_DESCRIPTION,
        GitStashBaseSchema.shape, // Use the shape from the BASE schema
        // Let TypeScript infer handler argument types.
        // The SDK validates against the full GitStashInputSchema before calling this.
        async (validatedArgs, callContext): Promise<CallToolResult> => {
          // Cast validatedArgs to the specific input type for use within the handler
          const toolInput = validatedArgs as GitStashInput;
          const toolOperation = `tool:${TOOL_NAME}:${toolInput.mode}`; // Include mode in operation
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

          logger.info(
            `Executing tool: ${TOOL_NAME} (mode: ${toolInput.mode})`,
            logicContext,
          );

          return await ErrorHandler.tryCatch<CallToolResult>(
            async () => {
              // Call the core logic function which returns a GitStashResult object
              const stashResult: GitStashResult = await gitStashLogic(
                toolInput,
                logicContext,
              );

              // Format the result as a JSON string within TextContent
              const resultContent: TextContent = {
                type: "text",
                text: JSON.stringify(stashResult, null, 2), // Pretty-print JSON
                contentType: "application/json",
              };

              // Log based on the success flag in the result
              if (stashResult.success) {
                logger.info(
                  `Tool ${TOOL_NAME} (mode: ${toolInput.mode}) executed successfully, returning JSON`,
                  logicContext,
                );
              } else {
                // Log specific failure message from the result
                logger.warning(
                  `Tool ${TOOL_NAME} (mode: ${toolInput.mode}) failed: ${stashResult.message}`,
                  {
                    ...logicContext,
                    errorDetails: stashResult.error,
                    conflicts: stashResult.conflicts,
                  },
                );
              }
              // Return the result, whether success or structured failure
              return { content: [resultContent] };
            },
            {
              operation: toolOperation,
              context: logicContext,
              input: validatedArgs, // Log the raw validated args
              errorCode: BaseErrorCode.INTERNAL_ERROR, // Default if unexpected error occurs in logic/wrapper
            },
          );
        },
      );

      logger.info(`Tool registered: ${TOOL_NAME}`, context);
    },
    { operation, context, critical: true },
  ); // Mark registration as critical
};
