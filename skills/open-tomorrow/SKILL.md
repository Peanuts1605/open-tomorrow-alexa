---
name: open-tomorrow
description: Run a small-business owner's day-off handover check with the Open Tomorrow MCP server. Use when the owner asks whether tomorrow (or a named day) is covered, says a helper can't come or said yes, wants to give a task to someone, or asks who is free. Covers only the tasks the owner entered, with simulated helper acceptance.
license: MIT
compatibility: Needs the Open Tomorrow MCP server (tools create_handover, check_coverage, change_handover) over Streamable HTTP or stdio.
metadata:
  version: "0.3.0"
  server: "https://open-tomorrow-alexa.gigantic-stranger.workers.dev/mcp?session=<8-64 letters, digits or dashes>"
---

# Open Tomorrow: the day-off handover check

Use this skill when an owner is about to take a day off and wants to know whether the work they listed is
covered. The MCP server holds the rules. Your job is to call the tools in the right order, then say what the
tool said in plain words. Don't decide coverage yourself.

## Tools

| Tool | Use it to | Notes |
| --- | --- | --- |
| `create_handover` | Start the plan for one day: people, their free hours, tasks and first assignments. | Never overwrites a plan. `PLAN_EXISTS` means call `check_coverage` instead. |
| `check_coverage` | Read the current revision, each task's blockers, `nextAction` and the last change. | Read-only. Call it before any change and whenever you are unsure. |
| `change_handover` | Make one change: `assign`, `record_acceptance`, `cancel`, `retime` (new start and end, in minutes after midnight) or `confirm_entered_scope`. | Send the `expectedRevision` you just read and a new `operationId` each time. |

All three tools return the MCP App board (`ui://open-tomorrow/board.html`). If your host supports MCP Apps,
let it show the board; otherwise read `structuredContent`.

## Workflow

1. **Load.** On "am I covered for Saturday?", call `create_handover` with the owner's tasks. If it returns
   `PLAN_EXISTS`, call `check_coverage`.
2. **Explain the first blocker.** Speak `nextAction` in one or two sentences, for example "Helper A has the
   set-up and the delivery, and they overlap from 8:30 to 9:00."
3. **Change one thing at a time.** Map what the owner says to one `change_handover` call:
   - "B can't come" → `cancel` for that person (their assignments become unassigned, and their old yes stops counting).
   - "Give the delivery to C" → `assign`.
   - "C said yes" → `record_acceptance` with the task's **current** `version` and `simulated: true`.
   - "That's everything" → `confirm_entered_scope` with `confirmed: true`, only after every task is accepted.
4. **On `STALE_REVISION`**, call `check_coverage` once and retry against the new revision. On any other
   error, say what it means. Don't retry blindly.
5. **Finish** only when `status` is `ENTERED_TASKS_COVERED`.

## Rules you must keep

- **Assigned is not agreed.** A task counts as covered only after a fresh acceptance for its current version.
- **Old yeses don't count.** After a cancel or reassignment, an acceptance for an older `taskVersion` is rejected
  (`STALE_OR_WRONG_ASSIGNMENT`). Tell the owner the helper must accept again.
- **Say "covered" only about the tasks the owner entered.** Always add that you can't vouch for anything they
  didn't mention. Never claim the business is safe, staffed legally or fully covered.
- **Nobody real is contacted.** Helpers and their acceptances are simulated. Don't offer to message, call or
  schedule real people with these tools.
- **Use the plan's ids only.** Never invent people or tasks. If you can't tell who the owner means, ask
  ("Helper A, B or C?").

## Example

Owner: "Helper B is sick, so give the flowers run to Helper C."

1. `check_coverage` → revision 6.
2. `change_handover` `{expectedRevision: 6, operationId: "turn-7a", change: {kind: "cancel", person: "driver"}}`.
3. `change_handover` `{expectedRevision: 7, operationId: "turn-7b", change: {kind: "assign", task: "delivery", person: "spare"}}`.
4. Say: "Done. The delivery is with Helper C now, but that's an assignment, not a yes. Helper C still needs to accept."
