# Integration contract — version 2 synthetic workspace

This contract describes the runnable local package. Its input is generated aggregate data for fictional Meridian Group. It is not a Workday tenant integration, enterprise authorization layer, employment decision engine, or production approval workflow.

## Runtime boundaries

Node.js 22.9+ and the standard library serve `public/` and JSON APIs. Default bind is `127.0.0.1:8787`; `BIND_HOST=0.0.0.0` requires `APP_PASSWORD` of at least 16 characters. `PUBLIC_ORIGIN`, if provided, is an exact HTTP(S) origin and permitted host. Host/origin checks, same-origin requests, payload limits, CSP and camera-denying permission policy are implemented. A shared password sets an HttpOnly, SameSite cookie; it is not SSO, individual access control or a substitute for TLS. State is saved to `STATE_DIR` by atomic file replacement. Local loopback without a password is a single-user demo.

`GET /health` returns local readiness. Authenticated `GET /api/status` reports `{version,mode,voiceInput,voiceOutput,live,review,workday,authentication,persistence,disclosure}`. `mode:'api'` says a server key is configured; it does **not** prove model entitlement, successful API calls, microphone permission or browser playback. `live.verification` is a fixed build-level flag (`not-live-verified`). The browser reports actual session events separately when a connection is exercised.

## Generated sources and revision

The connector emits seven paginated synthetic report names: `CoreHCM`, `Talent`, `Payroll`, `HRServiceSupplement`, `FinanceSupplement`, `ListeningSupplement` and `TalentCohorts`. The first six each have 240 function × region × month rows; the cohort extract has 20 rows. HR service, Finance and listening are separately labeled supplements, not Workday modules. The adapter validates dimensions, counts, continuity, partitions, bounded ratios and flow conservation before promoting a snapshot. See [docs/WORKDAY.md](docs/WORKDAY.md) for field mapping and production replacement needs.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/workday/status` | `{synthetic:true,connected:false,system,sourceVersion,sourceRevision,lastAttempt,lastSuccess,coverage,history}`. Attempts include UTC time, batch, result, row counts or rejection reason. |
| `GET /api/data/snapshot` | Complete aggregate dataset `{...baseline,cells,cohorts,sourceVersion}`. The browser hydrates its analytics from this versioned server snapshot. |
| `GET /api/workday/report?name=CoreHCM&cursor=0&limit=50&batch=baseline` | Illustrative paginated report with `{report,batch,sourceRevision,rows,nextCursor,total}`; limit 1–200. |
| `POST /api/workday/sync` with `{"batch":"baseline"}` | Replays/restores baseline. Successful response `{changed,status,snapshot}`. |
| Same endpoint with `{"batch":"correction"}` | Replays one synthetic goal-submission correction. Repeating it keeps the same version. |
| Same endpoint with `{"batch":"invalid"}` | Rejects an out-of-range count; the previous snapshot remains active and the failed attempt is recorded. |

`sourceVersion` is the digest of a named synthetic revision plus active cells/cohorts. It is a consistency token, not an external provenance attestation. A question or save against a stale revision receives HTTP 409. The browser must refresh, then repin observations from the new revision. The server calculates from the active snapshot, never from client-supplied numbers.

## Questions, voice and media

`POST /api/ask` accepts `{question,scope:{function,region,period},context?,history?,sourceVersion?}` and returns:

```js
{
  mode: 'demo' | 'api', question, answer, title,
  scope: { function, region, period }, sourceVersion,
  action: { type: 'metric' | 'scenario' | 'overview', metricId, caseId, overrides },
  facts: [{ label, value, note }],
  evidence: [{ id, definition, period, source }],
  followups: ['...'], boundary: '...'
}
```

Demo routing is deterministic and bounded to supported metrics/scenarios. In API mode, server-held `OPENAI_API_KEY` calls `gpt-6-astra` for a constrained structured routing plan, then deterministic code computes facts and six scenario outcomes. The model cannot replace the calculated figures. Scope, population, denominator, assumptions, definitions and source revision accompany the result. A scenario uses its fixed hypothetical population and complete effective inputs, rather than silently inheriting dashboard filter populations. Unsupported dates, private individual requests and causal claims must remain bounded.

`POST /api/transcribe` accepts supported recorded audio (`audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/wav`) and uses `gpt-transcribe` in API mode. `POST /api/speech` accepts `{text}` (1–3000 characters) and returns generated MP3 using `gpt-4o-mini-tts` in API mode. The turn-based client captures audio only after a click, stops tracks on completion/error, and does not save microphone bytes in the journal. Browser speech synthesis in demo mode is a preview and cannot be treated as capturable narration.

Continuous voice uses `POST /api/live/session` with a browser SDP offer and selected scope/history, returning a WebRTC SDP answer and session ID. The backend holds the private key and caps active sessions and duration. The client streams microphone input, receives AI voice and approximate transcript deltas, and sends questions to `POST /api/live/delegate`; this delegates to the same server question path and accepts results only for the matching session/delegation. `POST /api/live/close` initiates cleanup. The client closes tracks, audio and peer connection on stop/error/unload. Actual upstream session success, latency, interruption and final usage require a configured live test. Voice may bill while connected, including mute; the closing REST response does not claim final usage without the upstream `session.closed` event.

A structured response drives an evidence card and optional **narrated WebM**. API narration is attached to canvas video through Web Audio and MediaRecorder only after user action and browser capability checks. This is a briefing of synthetic figures, not an avatar, camera feed, live video understanding or capture of the user's microphone. The separate browser diagnostic records a brief microphone sample and a test-tone canvas WebM on click and can export its verification JSON; the tone is never labeled as spoken analysis.

### Connection diagnostics (2.0.1)

`GET /api/diagnostics` returns `workforce-connection-report.v1`: app/Node version, platform, boolean key/proxy/certificate configuration flags, the last explicit metadata check, and at most ten sanitized errors from the current server process. It makes no external request. `POST /api/diagnostics/connection` with `{}` performs one fixed `GET https://api.openai.com/v1/models/gpt-live-1` with a 10-second maximum deadline. Its JSON report returns HTTP 200 even when the upstream check failed; inspect `lastConnectionCheck.status` and `lastConnectionCheck.error`. This does not create a voice session, generate media, or establish WebRTC readiness. Metadata access/denial is not a definitive entitlement test for session creation.

Both endpoints use the existing workspace authentication and origin checks. Reports exclude key values, raw provider messages, stack traces, proxy addresses, local paths, audio, transcripts, SDP and workforce records. Safe error metadata includes an internal correlation ID, failure category/stage, allowlisted system/provider codes and an allowlisted provider request ID when available. Runtime flags describe configuration presence, not whether Node honored it. Reports are kept in memory and reset when the server restarts. Browser downloads add capability booleans and the last failure stage/correlation ID, without conversation content.

Classified request failures return `{error,code,diagnosticId,stage}`. Local request-validation errors retain their original bounded messages. If persisting the voice-start audit event fails after a session has been allocated, the server removes ownership and attempts best-effort session cleanup; it does not claim confirmed final usage.

## Decision workspace and second review

`POST /api/decisions` accepts one of six case IDs, bounded assumption overrides, record fields (rationale, dissent, owner, review date, stop gate, assumption captures), pinned metric references, optional context and `sourceVersion`. The server recalculates scenarios and reconstitutes pinned evidence from the active source; it refuses stale/invalid references. Returns an immutable saved draft with `id`, `savedAt`, `sourceVersion`, calculated values and `status:'draft-unapproved'`. `GET /api/decisions` lists the saved drafts. `GET /api/audit` returns bounded metadata events plus sync history. Drafts and metadata persist in `workspace.json`; no conversation transcript or microphone audio is persisted. Capacity limits are 100 saved drafts and the most recent 1,000 audit events.

`POST /api/review` with `{id}` reviews a saved draft. With both `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`, a Claude structured response critiques assumptions, risks, gates and missing evidence against the server-calculated result. With both values blank, a deterministic rules-based review is attached. An incomplete configuration fails visibly. The reviewer cannot change arithmetic or approve a decision. The user can download one draft or export the workspace JSON. The browser's Board/CEO/CHRO perspective switch is presentation only.

Production substitution requires authorized source queries, real identity and row/field entitlements, audited approvals, metric governance, source reconciliation, retention and privacy controls, service operations and target-browser tests. Never assume a synthetic display gate enforces production disclosure policy.

## Continuation contract: investigations

Authenticated `GET /api/investigations` lists saved investigations; `POST /api/investigations` validates the active source revision and freezes server-calculated evidence. Immutable, deduplicated records persist in an additive `investigations` array in schema-1 `workspace.json`, preserving existing decisions/audit events. Limits: 100 investigations, 50 pins per investigation, 500-character question and 4000-character notes. Stale revisions/pins return 409. Workspace exports include investigations. See [docs/INVESTIGATIONS.md](docs/INVESTIGATIONS.md) for the complete request and reload boundaries.


## Studio conversation and presentation — October 2026

Authenticated GET /api/studio/bootstrap returns {response,catalog}: a deterministic executive overview plus all 50 metric IDs, labels and definitions. It never calls a model. The Studio adds six scenario entries to this catalogue.

/api/ask accepts bounded conversation context: metricId, caseId, validated overrides, insightId, sourceVersion and pendingAssumption for a retention-unit clarification. A stale context revision returns409, even if the outer sourceVersion is current. Supported deterministic follow-ups reuse explicit scenario assumptions; only the requested fields change. Unknown language may use the existing strict model router. Unsupported compound steps produce a clarification instead of silently executing a subset.

Answers add conversation plus presentation:{version,scene,headline,takeaway,beats,nextQuestions,sourceVersion,chart?}. Beats reference answer fact indexes and evidence IDs. Scenario chart rows come from the same server calculator. Explicit supported compound requests add workflow, an ordered array of complete answers. No presentation field authorizes saving, approving or executing decisions.

Live delegation preserves event for compatibility and adds up to8 bounded events. The browser sends subsequent narration only after the matching injection acknowledgement. An acknowledgement does not indicate audio playback completion. New speech, explicit navigation, scope changes and Stop invalidate pending analysis and queued narration. Transcript-based emphasis is approximate. Studio changes no saved-state schema, credentials or approval status.
