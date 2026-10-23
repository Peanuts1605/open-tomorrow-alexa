# Friction log: Open Tomorrow for Alexa+

Problems we hit while building Open Tomorrow for Alexa+ (the Alexa+ track of the hackathon), with the workaround we used for each and what would have helped.

| # | Task attempted | Steps taken | Expected vs. actual | Severity | Workaround | Suggestion |
|---|---|---|---|---|---|---|
| 1 | Browser MCP client against a JSON-only Streamable HTTP server | Connected the SDK `Client` + `StreamableHTTPClientTransport` from the page | Expected: no errors. Actual: the client probes `GET /mcp`, and the correct 405 shows as a console error that looks like a bug | Low | Answer the probe in a custom `fetch` | Client option to disable the GET stream |
| 2 | Run a stateless MCP server inside a Durable Object | Searched SDK docs and Cloudflare docs for an example | Expected: a recipe. Actual: none, so we pieced it together from SDK source | Medium | Fresh `McpServer` per request with `WebStandardStreamableHTTPServerTransport` | Publish an official Workers + DO example |
| 3 | Test our MCP server on a real Alexa+ device | Looked for a self-serve way to connect a self-hosted MCP server | Expected: a sandbox. Actual: Alexa+ add-on tools are partner-only preview (per the hackathon FAQ) | High | Simulated Alexa+ web page acting as a real MCP client | Open a sandbox/simulator that speaks MCP |
| 4 | Learn how Alexa+ presents tool errors | Searched docs for `isError` handling | Expected: guidance. Actual: none found | Medium | Return `structuredContent` with one deterministic `nextAction` | Document `isError` / structured result rendering |
| 5 | Run Wrangler locally | `npx wrangler dev` on Node 20 | Expected: clear version error. Actual: unclear failure | Low | `npx node@22` | Check the Node version at startup with a clear message |
| 6 | Add an MCP Apps view to an SDK 1.x server | Installed the latest `@modelcontextprotocol/ext-apps` | Expected: works with SDK 1.30. Actual: 2.x needs SDK v2 | Medium | Pin ext-apps 1.7.5 | Publish a version compatibility table |
| 7 | Keep the MCP App view small | Bundled the view with esbuild | Expected: a small card. Actual: Zod's locales made it about twice as large | Low | esbuild plugin that keeps only the English locale | Ship an English-only or tree-shakable locale entry |
| 8 | Automated UI tests of the page | Playwright `wait_for_function` on the live page | Expected: works. Actual: blocked by our strict CSP (no `unsafe-eval`) | Low | Use locator-based waits instead | Note CSP interplay in Playwright docs |
| 9 | Stay inside the Workers AI free allocation | Looked for the account's AI plan and usage via the API | Expected: readable allocation/usage. Actual: unclear | Medium | Our own daily (250) and per-session (40) caps in a Durable Object, with the keyword fallback | Expose usage and allocation through the API |
