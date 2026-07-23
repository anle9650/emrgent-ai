import "server-only";

import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { useMockModels } from "@/lib/constants";
import { normalizeProviderSearchArgs } from "./taxonomy";

type McpTools = Awaited<ReturnType<MCPClient["tools"]>>;

const PROVIDER_SEARCH_TOOL_NAME = "search_individual_providers";

/**
 * Merge Agent Handler MCP integration.
 *
 * Exposes the NPI Registry's `search_individual_providers` tool (and whatever
 * else the configured Tool Pack contains) to the agent over MCP. Credentials
 * are scoped to a single shared Registered User configured via env — NPI
 * Registry is public data, so no per-user OAuth/Link flow is needed.
 *
 * Enabled only when all three env vars are present; otherwise skipped with no
 * crash, mirroring the OpenEMR OIDC gating in `app/(auth)/auth.ts`.
 */

const MERGE_MCP_BASE = "https://ah-api.merge.dev/api/v1";

function mergeConfig() {
  const apiKey = process.env.MERGE_AGENT_HANDLER_API_KEY;
  const toolPackId = process.env.MERGE_TOOL_PACK_ID;
  const registeredUserId = process.env.MERGE_REGISTERED_USER_ID;

  if (!(apiKey && toolPackId && registeredUserId)) {
    return null;
  }

  return { apiKey, toolPackId, registeredUserId };
}

export type MergeMcpTools = {
  client: MCPClient;
  tools: McpTools;
};

/**
 * Wraps the `search_individual_providers` tool so its `taxonomy_description`
 * argument is snapped to a canonical NUCC display name before the search runs
 * (see `taxonomy.ts`). The model reliably supplies colloquial/American-spelled
 * terms the NPI Registry validator rejects; correcting the arg deterministically
 * here means the fix doesn't depend on the model. Other tools pass through
 * untouched. Mutates the caller-owned `tools` record in place and returns it.
 */
function withTaxonomyNormalization(tools: McpTools): McpTools {
  const search = tools[PROVIDER_SEARCH_TOOL_NAME];
  if (!search?.execute) {
    return tools;
  }

  const inner = search.execute.bind(search);
  tools[PROVIDER_SEARCH_TOOL_NAME] = {
    ...search,
    execute: (args, options) =>
      inner(
        normalizeProviderSearchArgs(args as Record<string, unknown>),
        options
      ),
  };
  return tools;
}

/**
 * Creates an MCP client against Merge Agent Handler and returns its tools
 * adapted into AI SDK tools. Returns `null` when Merge is not configured, under
 * mock/test runs (so tests make no external calls), or when the connection
 * fails — the chat then runs without the NPI tool rather than erroring.
 *
 * The caller owns the returned `client` and must `close()` it once the stream
 * has finished (see the chat route's `onFinish`/`onError`).
 */
export async function createMergeMcpTools(): Promise<MergeMcpTools | null> {
  if (useMockModels) {
    return null;
  }

  const config = mergeConfig();
  if (!config) {
    return null;
  }

  const url = `${MERGE_MCP_BASE}/tool-packs/${config.toolPackId}/registered-users/${config.registeredUserId}/mcp`;

  let client: MCPClient | undefined;
  try {
    client = await createMCPClient({
      transport: {
        type: "http",
        url,
        headers: { Authorization: `Bearer ${config.apiKey}` },
      },
      // Read-only lookup is idempotent, so retrying transient transport
      // failures is safe.
      maxRetries: 2,
    });

    // Schema discovery: the Tool Pack is scoped to the tools we want, so this
    // returns exactly those and stays in sync if Merge tweaks the schema.
    const tools = await client.tools();

    return { client, tools: withTaxonomyNormalization(tools) };
  } catch (error) {
    console.error("Failed to initialize Merge Agent Handler MCP tools", error);
    await client?.close().catch(() => {
      /* best-effort cleanup */
    });
    return null;
  }
}
