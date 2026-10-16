# Open Tomorrow

The last check before your day off.

A fictional flower-shop owner has arranged Saturday cover. One helper is assigned to set up the shop **08:00–09:00** and deliver flowers **08:30–09:15**. That is not a workable handover. Open Tomorrow exposes the exact conflict, separates assignment from acceptance, and reopens the affected duty when a helper cancels.

This is an early, working **local MCP server**, not a completed contest entry or Alexa integration. Its helpers and acceptance actions are explicitly simulated. It does not send messages or alter anybody's real schedule.

## Run the complete proof

Use Node 22+ and npm:

```sh
npm ci --ignore-scripts
npm test
npm run demo
```

No API key, AWS account, Amazon device, model service, payment, or sign-in is required. `demo` starts a server on an ephemeral loopback port, connects using the official MCP client over Streamable HTTP, discovers and calls the actual tools, restarts the server, and checks that state survived. Fixture state is saved to a uniquely named OS temporary directory; no user plan is overwritten.

The successful demonstration proves:

1. The exact 08:30–09:00 overlap blocks coverage.
2. Moving delivery to a second helper does not invent acceptance.
3. Simulated helper acceptance plus explicit entered-scope confirmation permits the narrowly scoped result, “All entered tasks have simulated accepted coverage.”
4. Cancelling the second helper reopens delivery while leaving setup and its acceptance intact.
5. Acceptance from the cancelled assignment is rejected.
6. The changed plan survives a process restart and a new MCP connection.

Each `check_coverage` result also returns one deterministic `nextAction`. Across all entered tasks, it puts assignment, availability or overlap ahead of simulated acceptance; after all entered tasks are accepted, it asks for an explicit entered-scope review. `nextAction` becomes `null` only when the narrowly scoped simulated handover is covered. This is guidance from entered facts, not a message to a real helper or a claim that omitted duties are safe.

## Simulated Alexa+ experience (web)

Live: **https://open-tomorrow-alexa.gigantic-stranger.workers.dev/**

A judge-facing page that simulates the Alexa+ voice layer. Scripted voice turns are shown, and optionally spoken with the browser's speech synthesis. Every Alexa+ reply is built from live MCP tool results. The browser runs the official MCP TypeScript SDK client. It talks over Streamable HTTP (2025-11-25) to the same `create_handover`, `check_coverage` and `change_handover` tools (`tools.mjs`, `coverage.mjs`), served by a Cloudflare Worker (`web/worker.mjs`). Each visitor gets a private Durable Object session that expires after a day. The voice layer is simulated; the tool calls are not.

```sh
npm ci
node web/build.mjs          # bundles the browser client and the Worker into dist/
npx wrangler dev            # local Worker on http://127.0.0.1:8787 (wrangler needs Node 22+)
node web/smoke.mjs http://127.0.0.1:8787   # end-to-end MCP check against a local or deployed Worker
npx wrangler deploy         # deploy (uses wrangler.toml)
```

## MCP surface

`npm start` serves `http://127.0.0.1:8917/mcp` and stores its single local plan in `.local/plan.json`. Compatible agent clients can call:

- `create_handover`: initialize explicit dated tasks and helper availability once.
- `check_coverage`: read exact blockers, the first safe next action, entered-scope status and last affected tasks.
- `change_handover`: version-checked assignment, simulated acceptance, cancellation, time correction, or scope confirmation.

Protocol **2025-11-25**, negotiated and verified in the demonstration using `@modelcontextprotocol/sdk` 1.30.0. This is not a wrapper claiming integration only in documentation: the actual client/server transport and tools run in the proof.

## Deliberate boundaries

- All acceptance is a **simulated helper action**, not identity-authenticated consent. A production acceptance flow is not implemented.
- The result covers **entered tasks only**. Missing duties are unknown, not safe. This is not labor-law, staffing, travel-time, safety or business-continuity advice.
- One day, explicit local wall-time minutes, one operator/server process. Multiple processes sharing a store are unsupported. No shift import, optimization, real-time integrations, employee messaging or automatic plan completion is claimed.
- Loopback only; browser origins rejected. Do not expose this development server to the network. Authentication, multi-user isolation and public hosting are not implemented.
- No language-model reasoning, speech recognition, Alexa-device execution or end-user validation has been demonstrated yet. The scripted proof is labeled as a scripted proof. The web page simulates the Alexa+ voice layer with scripted turns; only its MCP tool calls are real.

## Contest status and provenance

Candidate for the Alexa+ track of the [Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/). The prior Open Tomorrow idea was written in July; this implementation began September 11. Final entry must disclose this history accurately and include a judge-facing experience, public under-three-minute video and truthful tool feedback. This repository is not evidence of registration or submission; only Devpost's provider state can establish those facts.

AI-assisted design and code by Codex. The authored fixture contains no real shop, employee or customer information. No third-party media assets are used. The MCP SDK and Zod retain their respective open-source licenses.
