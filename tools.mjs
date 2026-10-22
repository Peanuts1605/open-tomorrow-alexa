// The three Open Tomorrow MCP tools, shared by the local Node server and the Cloudflare Worker.
// Each tool also declares an MCP Apps view (ui://open-tomorrow/board.html): hosts that support MCP Apps render the
// handover board as an interactive card next to the tool result; other hosts just get the JSON and text.
import * as z from 'zod/v4';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { Plan, Change } from './coverage.mjs';
import { BOARD_APP_HTML } from './web/board-app.generated.mjs';

export const BOARD_URI = 'ui://open-tomorrow/board.html';

export function registerTools(server, store) {
  const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
  const guarded = fn => async args => {
    try { return result(fn(args)); }
    catch (err) { return { isError: true, content: [{ type: 'text', text: err.message }] }; }
  };
  const ui = { ui: { resourceUri: BOARD_URI } };
  registerAppTool(server, 'create_handover', {
    description: 'Initialize one fictional one-day handover. Never overwrites a plan. Explicit supplied tasks and availability only.',
    inputSchema: { plan: Plan }, _meta: ui
  }, guarded(({ plan }) => store.create(plan)));
  registerAppTool(server, 'check_coverage', {
    description: 'Read exact coverage blockers, the first safe next action and last change. Covered means entered tasks only, with simulated acceptance, never business safety.',
    inputSchema: {}, annotations: { readOnlyHint: true }, _meta: ui
  }, guarded(() => store.read()));
  registerAppTool(server, 'change_handover', {
    description: 'Apply one version-checked fictional assignment, simulated acceptance, cancellation, time correction or scope confirmation. Read current revision first. No employee messages are sent.',
    inputSchema: { expectedRevision: z.number().int().positive(), operationId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/), change: Change }, _meta: ui
  }, guarded(args => store.apply(args)));
  registerAppResource(server, 'Handover board', BOARD_URI, {
    description: 'Interactive handover board: each task, who has it, and whether it is covered, waiting for a yes, or blocked.'
  }, async () => ({
    contents: [{ uri: BOARD_URI, mimeType: RESOURCE_MIME_TYPE, text: BOARD_APP_HTML, _meta: { ui: { prefersBorder: true } } }]
  }));
}
