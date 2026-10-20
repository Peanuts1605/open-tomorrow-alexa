# Open Tomorrow for Alexa+ — submission kit (draft)

Contest: Amazon Developer Hackathon, Alexa+ track — https://amazonappdev2026.devpost.com (closes Oct 23, 2026, 3:00 PM ET).
Live demo: https://open-tomorrow-alexa.gigantic-stranger.workers.dev/
Status: draft for review. Nothing here has been submitted, pushed or posted.

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
A judge can break it: type "Helper B can't come", then "Helper B said yes" — Alexa+ refuses to count it. Then hand it to Helper C, accept on a phone, and watch it turn green.

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
| Oct 16 (afternoon) | Today's additions: free-text/mic turns via deterministic intent router, QR helper-accept flow, "Play all" ends covered via Helper C, next-Saturday date, 2× speed, mobile polish, no console errors, retitle, this submission kit. | Commit on branch `alexa-sim-web` (this file's commit). |

All code in this repository was written after Aug 31, 2026.

## 5. Friction log / product feedback

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
