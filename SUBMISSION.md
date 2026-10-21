# Open Tomorrow for Alexa+ — submission kit

Contest: Amazon Developer Hackathon, Alexa+ track — https://amazonappdev2026.devpost.com (closes Oct 23, 2026, 3:00 PM ET).
Live demo: https://open-tomorrow-alexa.gigantic-stranger.workers.dev/
Source: https://github.com/Peanuts1605/open-tomorrow-alexa

---

## 1. GitHub About line (≤350 chars)

> Self-hosted MCP server (2025-11-25, Streamable HTTP) plus a simulated Alexa+ experience: ask "is tomorrow covered?" and get an answer that won't lie — exact clashes, acceptance vs. assignment, and cancellations that reopen tasks. Fictional data, live tool calls.

Topics: `mcp` `model-context-protocol` `alexa-plus` `cloudflare-workers` `durable-objects` `small-business`

## 2. README intro (applied in README.md)

> # Open Tomorrow for Alexa+
>
> The last check before your day off, and it won't tell you you're covered when you're not.
>
> Open Tomorrow is a **self-hosted MCP server** (protocol **2025-11-25**, Streamable HTTP) plus a **simulated Alexa+ experience** that calls it live. A small-business owner asks Alexa+ whether tomorrow is covered; Open Tomorrow checks the real handover: exact time clashes, who has actually *accepted* (not just been assigned), and whether a cancellation reopened a task. An old "yes" for a cancelled assignment never counts.

The old "not a completed contest entry or Alexa integration" sentence was removed from the README; the honest boundaries (simulated voice layer, simulated acceptance, fictional data) stay in the "Deliberate boundaries" section.

## 3. Devpost text description

**Inspiration**
Every small-business owner knows the night-before feeling: "I think Saturday's covered." Usually it isn't quite — one person is down for two things at once, someone was *assigned* but never said yes, or a helper cancelled and the gap went unnoticed. A voice assistant that cheerfully says "you're all set" makes that worse. We wanted Alexa+ to be the one thing that won't lie to you.

**What it does**
You ask Alexa+, "I'm off Saturday — is the flower shop covered?" Alexa+ calls the Open Tomorrow MCP server and answers from real tool results:
- It finds the exact clash ("Helper A is down for setup and delivery, and those overlap 8:30 to 9:00").
- It separates *assigned* from *agreed*: nothing is covered until the assigned helper accepts that exact version of the task.
- When a helper cancels, it reopens only the affected task, and it **rejects the old "yes"** from the cancelled assignment.
- It only says "covered" for the tasks you entered, after you confirm that's the whole list.
- A helper can accept from their own phone: scan the QR code, tap Accept, and the owner's screen flips to covered ✅.

**How we built it**
- MCP server: three tools — `create_handover`, `check_coverage`, `change_handover` — over Streamable HTTP, protocol 2025-11-25, using the official MCP TypeScript SDK and Zod schemas. Every change is revision-checked and idempotent (operation IDs), so a stale or replayed request can't silently overwrite the plan.
- Hosting: one Cloudflare Worker serves the page and the MCP endpoint; each visitor gets a private Durable Object session that expires after a day.
- Simulated Alexa+ layer: the browser runs a real MCP client. Scripted turns ("Play all", with 2× speed) and free-text or spoken turns (Web Speech API where supported) go through a deterministic intent router — who's free, someone can't come, give a task to someone, a helper said yes, what's uncovered, that's everything — onto the same tool calls. Every call is shown live in the "MCP wire" panel.
- Helper QR: generated locally in the page (no external services); the phone card records a simulated acceptance through the same coverage rules.

**Challenges**
Making "covered" mean something narrow and true: acceptance is tied to a task version, so any reassignment or retime invalidates old yeses automatically. Keeping the demo honest about what is simulated (voice, helpers) versus real (the tool calls and their rules).

**Accomplishments**
A judge can watch it refuse to be fooled: press "Start the conversation" and step through. After Helper B cancels, the next turn tries to reuse B's old yes, and the server rejects it live (a red `STALE_OR_WRONG_ASSIGNMENT` error in the wire panel). Then type "Give it to Helper C", accept on a phone from the QR card, and watch the board turn green.

**What we learned**
The most valuable thing an assistant can say about tomorrow is often "not yet," with the one next step that fixes it.

**What's next**
Real Alexa+ action wiring to the MCP server, real helper identity on the accept card, recurring weekly templates and more than one day.

**Built with:** Model Context Protocol (TypeScript SDK 1.30), Node.js, Zod, Cloudflare Workers, Durable Objects, Web Speech API, esbuild.

**Honesty note:** The Alexa+ voice layer is simulated in the browser; the MCP tool calls are real. All people, the shop and every acceptance are fictional. Free-text understanding is a deterministic router, not a language model.

## 4. Built after Aug 31 (dated)

| Date (2026) | What | Evidence |
|---|---|---|
| July | Prior Open Tomorrow *idea* written (concept only, no code). | Disclosed here. |
| Sep 11 | Code started: MCP coverage server, tools, tests, reproducible demo. | Commit `ccc3ae0` (2026-09-11 11:02 ET). |
| Oct 1 | Deterministic `nextAction` guidance. | Commit `2d74643`. |
| Oct 16 (morning) | Web layer: simulated Alexa+ page, Cloudflare Worker, Durable Object sessions. | Commit `879d3a4` (2026-10-16 13:41 ET). |
| Oct 16 (afternoon) | Free-text/mic turns via deterministic intent router, QR helper-accept flow, "Play all" ends covered via Helper C, next-Saturday date, 2× speed, mobile polish, no console errors, retitle, this submission kit. | Commit `c9484f5` (2026-10-16 14:20 ET). |
| Oct 20 | Review fix: "give it to …" keeps the task that was just discussed; video script no longer resets mid-demo. | Commit `afbecce` (2026-10-20 17:28 ET). |
| Oct 20 | Microphone fix: permission is requested inside the click, with visible states and a level meter. | Commit `bea90c1` (2026-10-20 19:24 ET). |
| Oct 21 | Microphone permission cancel/retry race guarded, with tests. | Commit `1098f153` (2026-10-21 09:48 ET). |
| Oct 21 | Footer links to this repository, bare "yes" confirms the task list, product feedback, README wording. | Branch `mag82-fulcro-fixes` (2026-10-21). |

All code in this repository was written after Aug 31, 2026.

## 5. Product feedback (per tool) and friction log

Lines marked [CONFIRM] are opinions Maggy must confirm or edit before pasting into Devpost. Everything else is taken from the commits, the build notes and the deploy records.

### 5.1 Model Context Protocol TypeScript SDK (`@modelcontextprotocol/sdk` 1.30.0)
- **Used for:** the whole MCP layer. `McpServer` + `StreamableHTTPServerTransport` for the local Node server (`server.mjs`); `Client` + `StreamableHTTPClientTransport` for the scripted proof (`demo.mjs`), the smoke test (`web/smoke.mjs`) and the in-browser client on the judge page; `WebStandardStreamableHTTPServerTransport` inside the Cloudflare Worker (`web/worker.mjs`). Protocol 2025-11-25 is negotiated and asserted in the demo and the smoke test.
- **What worked well:**
  - The same three tools ran unchanged in Node and in a Worker; only the transport differs.
  - Protocol version negotiation worked and was easy to assert in tests.
  - `structuredContent` let the voice layer read exact blockers and one `nextAction` instead of parsing text.
  - [CONFIRM] Server and client APIs mirror each other, which made an end-to-end test in one script easy.
- **What needs work:**
  - The web-standard (serverless) transport isn't in the getting-started docs; we found it in the SDK's dist folder.
  - Stateless, JSON-only servers have no official recipe; we inferred `sessionIdGenerator: undefined` + `enableJsonResponse: true`.
  - The client always probes `GET /mcp` for an SSE stream. Our JSON-only server correctly answers 405, but browsers log it as an error, so we answer the probe inside the client's custom `fetch`.
  - The bundled browser client (with Zod and JSON-schema validation) is about 300 KB minified.
- **Onboarding (zero to hello world):** [CONFIRM] Zero to a working hello-world tool in under an hour with the modelcontextprotocol.io getting-started guide.
- **Would we build with it again?** [CONFIRM] Yes. One server works for any MCP-capable agent, which is why Alexa+ using MCP matters to small builders.

### 5.2 Cloudflare Workers + Durable Objects
- **Used for:** hosting the judge page and the MCP endpoint in one Worker (`web/worker.mjs`), with one Durable Object (`HandoverSession`) per visitor holding that visitor's plan. A Durable Object alarm clears the session after a day.
- **What worked well:**
  - The MCP SDK's web-standard transport ran in the Worker with no changes to the tool code.
  - Per-visitor state needed no database: each session ID maps to its own Durable Object.
  - Redeploys kept the same Durable Object binding with no migration step, and earlier versions stayed available for a one-call rollback.
  - [CONFIRM] For a small, stateful demo, Workers + Durable Objects felt like the right size of tool.
- **What needs work:**
  - There is no official example of running an MCP server inside a Durable Object; we assembled it from SDK source and Cloudflare docs.
  - [CONFIRM] Choosing between `nodejs_compat` and web-standard code paths took trial and error.
- **Onboarding (zero to hello world):** [CONFIRM] Quick for a plain Worker; the Durable Object + MCP combination took longer because of the missing example.
- **Would we build with it again?** [CONFIRM] Yes, for small stateful demos like this one.

### 5.3 Web Speech API (browser `SpeechRecognition` and `speechSynthesis`)
- **Used for:** optional spoken Alexa+ replies ("Voice", `speechSynthesis`) and the optional microphone input (`SpeechRecognition` / `webkitSpeechRecognition`, `web/mic.mjs`). Recognized text goes through the same deterministic router as typed text.
- **What worked well:**
  - Free and built into the browser: no keys, accounts or servers.
  - Speech synthesis needed only a few lines, including the 2× speed option.
- **What needs work:**
  - The microphone was silent until we requested `getUserMedia` directly inside the click and added a `Permissions-Policy` header (commit `bea90c1`).
  - Recognition error codes (`not-allowed`, `service-not-allowed`, `network`, `no-speech`, `audio-capture`) each needed our own plain-language message, or the mic just looked broken (also commit `bea90c1`).
  - A cancelled permission prompt followed by a quick retry could let the old attempt interfere with the new one; we added a per-attempt guard and tests (commit `1098f153`).
  - Support differs by browser, so the page always offers typing as well.
- **Onboarding (zero to hello world):** [CONFIRM] Speech output worked on the first try; reliable microphone input took three rounds of fixes.
- **Would we build with it again?** [CONFIRM] Yes for prototypes. A real Alexa+ voice path would replace it in production.

### 5.4 Wrangler (Cloudflare CLI, 4.x)
- **Used for:** local development of the Worker (`npx wrangler dev`, configured by `wrangler.toml`) and as the documented deploy path in the README.
- **What worked well:**
  - `wrangler dev` gave a local Worker with Durable Object state on disk, so the end-to-end smoke test could run before any deploy.
  - [CONFIRM] One `wrangler.toml` was enough configuration for the Worker and its Durable Object binding.
- **What needs work:**
  - Wrangler requires Node 22+. Our build machine had Node 20, so we ran it through `npx node@22`. A clearer error at the start would save time.
  - Our build machine deploys went through the Cloudflare API (a script upload with the same Durable Object binding) instead of `wrangler deploy`, so on our side Wrangler was used for local runs, not production deploys.
- **Onboarding (zero to hello world):** [CONFIRM] Fast once the Node version was sorted out.
- **Would we build with it again?** [CONFIRM] Yes.

### Friction log (kept from the Oct 16 build)

- **MCP Streamable HTTP, JSON-only servers:** the TypeScript client always probes `GET /mcp` for an SSE stream. A JSON-response server correctly answers 405, but browsers log it as a console error that looks like a bug to judges. We answer that probe locally in the client's custom `fetch`. A client option to skip the GET stream would help.
- **Stateless transport + Durable Objects:** running a fresh `McpServer` per request inside a Durable Object works well, but there is no official example for Workers + DO with the SDK's web-standard transport; we pieced it together from source.
- **Alexa+ developer path:** we couldn't find a self-serve way to point a real Alexa+ device at a self-hosted MCP server for testing, so the voice layer is simulated. A sandbox or simulator that speaks MCP would let indie builders show the real thing.
- **Tool design:** returning `structuredContent` plus a single deterministic `nextAction` made it easy for the voice layer to give one clear next step instead of a list of problems. We'd love guidance on how Alexa+ surfaces `isError` tool results to users.
- **Wrangler requires Node 22+;** our box had Node 20, so we ran it via `npx node@22`. A clearer early error would save time.

## 6. Video script (target 2:40, hard limit < 3:00)

Record on the live page at 1280×800, voice on. Keep a phone ready for the QR.

| Time | Screen | Voiceover |
|---|---|---|
| 0:00–0:15 | Title card, then the live page. | "Most assistants will happily tell you you're all set. Open Tomorrow for Alexa+ is the last check before your day off, and it won't lie to you." |
| 0:15–0:30 | Point at the MCP wire panel. | "Every answer comes from a real MCP server, protocol 2025-11-25 over Streamable HTTP, running on Cloudflare. The voice layer here is simulated; the tool calls are real." |
| 0:30–1:05 | Press **Play all** (1×). Turns 1–4: clash found, delivery to Helper B, both say yes, confirm list → covered. | "Saturday at a fictional flower shop. It finds the exact overlap, 8:30 to 9:00. Assigning someone isn't the same as a yes. Only when both accept and I confirm the list does it say covered, and only for the tasks I entered." |
| 1:05–1:30 | Turns 5–6: Helper B cancels; "their old yes still counts, right?" Red `isError: STALE_OR_WRONG_ASSIGNMENT` in the wire. | "Then Helper B cancels. And here's the moment that matters: I try to reuse their old yes. The server rejects it live. That yes was for a cancelled assignment, so it doesn't count." |
| 1:30–1:55 | Keep the current handover (do not reset: setup acceptance and scope confirmation must remain). Type "Where do we stand?", then "Who's free?". | "It isn't just a script. I can type, or talk, anything like this. A deterministic router turns my words into the same tool calls. Watch the wire: the same rules tell me what is still uncovered and who is actually free." |
| 1:55–2:25 | Type "Give it to Helper C". QR card appears. Scan with phone, show the helper card, tap **Accept**. | "I hand it to Helper C. That's still just an assignment. Helper C scans this code, sees exactly what they're agreeing to, and taps accept." |
| 2:25–2:40 | Main screen flips: board green, "Entered tasks covered", Alexa+: "You're covered ✅". | "A fresh yes for the current assignment. Now, and only now, Alexa+ says I'm covered." |
| 2:40–2:50 | End card: live URL + repo. | "Open Tomorrow for Alexa+. Try to break it yourself at the link below." |

## Not included
Open Source mini challenge: skipped by decision.
