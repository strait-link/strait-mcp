/**
 * The package's library entry (import '@straitlink/mcp'): the same server and tools the stdio
 * command serves, for hosts that serve MCP themselves (the Strait engine's remote /mcp endpoint).
 */
export { createStraitServer, runTool, redactSecrets, SERVER_NAME, SERVER_VERSION } from './server.js';
export { StraitClient, StraitApiError, isSecretKey, DEFAULT_API_URL, type StraitClientOptions } from './client.js';
export { TOOLS, SERVER_INSTRUCTIONS, type StraitTool } from './tools.js';
export { PROMPTS, type StraitPrompt } from './prompts.js';
