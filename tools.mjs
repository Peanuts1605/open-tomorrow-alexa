// The three Open Tomorrow MCP tools, shared by the local Node server and the Cloudflare Worker.
import * as z from 'zod/v4';
import { Plan, Change } from './coverage.mjs';

export function registerTools(server, store) {
  const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
  const guarded = fn => async args => {
    try { return result(fn(args)); }
    catch (err) { return { isError: true, content: [{ type: 'text', text: err.message }] }; }
  };
    server.registerTool('create_handover', {
      description: 'Initialize one fictional one-day handover. Never overwrites a plan. Explicit supplied tasks and availability only.',
      inputSchema: { plan: Plan }
    }, guarded(({ plan }) => store.create(plan)));
    server.registerTool('check_coverage', {
      description: 'Read exact coverage blockers, the first safe next action and last change. Covered means entered tasks only, with simulated acceptance, never business safety.',
      inputSchema: {}, annotations: { readOnlyHint: true }
    }, guarded(() => store.read()));
    server.registerTool('change_handover', {
      description: 'Apply one version-checked fictional assignment, simulated acceptance, cancellation, time correction or scope confirmation. Read current revision first. No employee messages are sent.',
      inputSchema: { expectedRevision: z.number().int().positive(), operationId: z.string().regex(/^[a-zA-Z0-9-]{1,80}$/), change: Change }
    }, guarded(args => store.apply(args)));
}
