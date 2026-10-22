# For judges: each criterion and rule, and where to check it

Open Tomorrow is a self-hosted MCP server plus a simulated Alexa+ experience. You ask "am I covered for
Saturday?" and it answers only from version-checked tool results. Everything below links to the file that does
the work.

**Fastest check (2 minutes):** open the [live demo](https://open-tomorrow-alexa.gigantic-stranger.workers.dev/),
press **Play all** at 2×, and watch the **MCP wire** and **MCP App card** panels. Then press **Reset**, start the
conversation and type in your own words, for example *"Helper A is swamped, let Helper B take the flowers run"*.
A `Workers AI · interpret` entry and the resulting `change_handover` call appear in the wire.

**Locally (no keys, no accounts):** `npm ci --ignore-scripts && npm test && npm run demo`

## Stage One: fits the theme and uses the required tech

| Requirement | Where |
| --- | --- |
| Alexa+ track, simulated-experience path: a web page that is a real MCP client (initialize, tools/list, tools/call over Streamable HTTP) | [`web/client.mjs`](../web/client.mjs) `connect()` and `call()`; live wire panel on the demo |
| Self-hosted MCP server, spec 2025-11-25, official TypeScript SDK | [`tools.mjs`](../tools.mjs), [`server.mjs`](../server.mjs) (Node), [`web/worker.mjs`](../web/worker.mjs) (Cloudflare Worker); the protocol version is asserted in [`demo.mjs`](../demo.mjs) and [`web/smoke.mjs`](../web/smoke.mjs) |
| Public repo with an open-source license and run instructions | [`LICENSE`](../LICENSE) (MIT), [`README.md`](../README.md#run-the-complete-proof) |

## Stage Two: the four equally weighted criteria

### Tech Implementation

| Claim | Evidence |
| --- | --- |
| Coverage rules are code, not prompts: version-bound acceptance, exact overlap, scope confirmation, one deterministic `nextAction` | [`coverage.mjs`](../coverage.mjs), [`coverage.test.mjs`](../coverage.test.mjs) |
| Every change is revision-checked and idempotent (`expectedRevision`, `operationId`); stale writes are rejected | `CoverageStore.apply` in [`coverage.mjs`](../coverage.mjs); the `STALE_REVISION` retry is in `change()` in [`web/client.mjs`](../web/client.mjs) |
| **MCP Apps** view (`ui://open-tomorrow/board.html`, `text/html;profile=mcp-app`) declared on all three tools; the page hosts it with the official `AppBridge` in a sandboxed iframe, and the view's Refresh calls `check_coverage` through the host | [`web/board-app.mjs`](../web/board-app.mjs), [`web/board-app.html`](../web/board-app.html), `registerAppResource` in [`tools.mjs`](../tools.mjs), `mountApp()` in [`web/client.mjs`](../web/client.mjs), [`tools.test.mjs`](../tools.test.mjs) |
| **Workers AI** language layer (Llama 3.3 70B, JSON-schema output). "The model proposes, the rules decide": the model returns at most 3 `{action, person, task}` steps; ids are checked against the plan; a wrong-person guard applies; each step is rewritten as a sentence the deterministic router must classify the same way; anything else falls back to the keyword router | [`web/ai.mjs`](../web/ai.mjs), [`web/ai.test.mjs`](../web/ai.test.mjs), `/interpret` in [`web/worker.mjs`](../web/worker.mjs) |
| Cost guard: a global daily cap of 250 calls (≤ ~5,000 neurons, half of Workers AI's free 10,000 per day) and 40 calls per session; past the cap the page silently uses the keyword router | `DAILY_CAP` and `SESSION_CAP` in [`web/ai.mjs`](../web/ai.mjs); the `ai_budget` Durable Object in [`web/worker.mjs`](../web/worker.mjs) |
| One private Durable Object per visitor, expired after a day; origin and session guards | [`web/worker.mjs`](../web/worker.mjs) |
| Tests: 38 unit and integration tests, plus an end-to-end smoke test against the deployed Worker | `npm test`; `node web/smoke.mjs <url>` |

### Design

| Claim | Evidence |
| --- | --- |
| Voice-first and multimodal: scripted or free speech (Web Speech mic), spoken replies, a timeline board, an MCP App card, and a phone QR card for the helper | [`web/page.html`](../web/page.html), [`web/mic.mjs`](../web/mic.mjs), [`web/helper.mjs`](../web/helper.mjs) |
| Replies say the one next thing to fix ("those overlap from 8:30 to 9:00. Want to move one of them?"), never a bare status | `explain()` in [`web/client.mjs`](../web/client.mjs) |
| Honest scope everywhere: "covered" means the tasks you entered, with simulated acceptance | page footer; `limitations` in every tool result |
| Mobile layout, reduced-motion support, and a live region for screen readers | CSS media queries and `aria-live` in [`web/page.html`](../web/page.html) |

### Potential Impact

There were **5,720,093 US small businesses with 1 to 19 employees** in the SBA Office of Advocacy's
[2025 United States small business profile](https://advocacy.sba.gov/wp-content/uploads/2025/06/United%5FStates%5F2025-State-Profile.pdf).
That is the owner-plus-a-few-helpers business this check is for. In
[Adobe's 2025 survey of 1,018 US solopreneurs and small-business owners](https://www.adobe.com/acrobat/resources/work-life-balance-trends-for-entrepreneurs.html),
nearly half said they find it hard to disconnect on time off, and they averaged only 11 days off a year.
Open Tomorrow makes one narrow promise that lets an owner actually log off: every task you listed has a current
assignee who said yes to that exact version.

Beyond the hackathon, the MCP server works with any MCP client today, and the [Agent Skill](../skills/open-tomorrow/SKILL.md) teaches any skills-aware agent to use it safely.

### Quality of the Idea (the track's "creative" list)

| The track lists as creative | Open Tomorrow |
| --- | --- |
| Agentic workflow | One spoken sentence ("B is sick, give the flowers to C") becomes a checked multi-step plan: `cancel` → `assign`, each a separate version-checked tool call ([`web/ai.mjs`](../web/ai.mjs), `understand()` in [`web/client.mjs`](../web/client.mjs)) |
| Maintains state across sessions | The plan lives in a Durable Object. It survives reconnects and is changed from a second device (the helper's phone), and the owner's screen picks it up ([`web/worker.mjs`](../web/worker.mjs), [`web/smoke.mjs`](../web/smoke.mjs) "persistence") |
| Media support (cards) | Helper QR card, timeline board, and the MCP App card |
| MCP Apps | `ui://open-tomorrow/board.html` ([`tools.mjs`](../tools.mjs), [`web/board-app.mjs`](../web/board-app.mjs)) |
| Agent Skills | [`skills/open-tomorrow/SKILL.md`](../skills/open-tomorrow/SKILL.md), tested against the real tool names in [`skills/skill.test.mjs`](../skills/skill.test.mjs) |

The idea is the opposite of "you're all set": an assistant that refuses a stale "yes"
(`STALE_OR_WRONG_ASSIGNMENT`, visible live in the wire panel).

## What is real and what is simulated

| Real | Simulated |
| --- | --- |
| MCP server, tools, rules, MCP App view, Workers AI step parsing, persistence, the phone accept round trip | The Alexa+ voice layer (no Alexa device or console is available to hackathon entrants, per the FAQ), the shop, the helpers and their acceptances |

## Timeline

The idea was written down in July 2026. Code started on September 11, 2026, inside the submission period. See
the commit history; v2 (MCP App, Workers AI layer, Agent Skill, this page) was added on October 22, 2026.
AI-assisted design and code.
