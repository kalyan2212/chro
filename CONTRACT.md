# Integration contract — version 2 synthetic workspace

This contract describes the runnable local package. Its input is generated aggregate data for fictional Meridian Group. It is not a Workday tenant integration, enterprise authorization layer, employment decision engine, or production approval workflow.

## Runtime boundaries

Node.js 22.9+ and the standard library serve `public/` and JSON APIs. Default bind is `127.0.0.1:8787`; `BIND_HOST=0.0.0.0` requires `APP_PASSWORD` of at least 16 characters. `PUBLIC_ORIGIN`, if provided, is an exact HTTP(S) origin and permitted host. Host/origin checks, same-origin requests, payload limits, CSP and camera-denying permission policy are implemented. A shared password sets an HttpOnly, SameSite cookie; it is not SSO, individual access control or a substitute for TLS. State is saved to `STATE_DIR` by atomic file replacement. Local loopback without a password is a single-user demo.

`GET /health` returns local readiness. Authenticated `GET /api/status` reports `{version,mode,voiceInput,voiceOutput,live,review,workday,authentication,persistence,disclosure}`. `mode:'api'` says a server key is configured; it does **not** prove model entitlement, successful API calls, microphone permission or browser playback. `live.verification` is a fixed build-level flag (`not-live-verified`). The browser reports actual session events separately when a connection is exercised.

## Generated sources and revision

The connector emits seven paginated synthetic report names: `CoreHCM`, `Talent`, `Payroll`, `HRServiceSupplement`, `FinanceSupplement`, `ListeningSupplement` and `TalentCohorts`. The first six each have 240 function × region × month rows; the cohort extract has 20 rows. HR service, Finance and listening are separately labeled supplements, not Workday modules. The adapter validates dimensions, counts, continuity, partitions, bounded ratios and flow conservation before promoting a snapshot. See [docs/WORKDAY.md](docs/WORKDAY.md) for field mapping and production replacement needs.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/workday/status` | `{synthetic:true,connected:false,system,sourceVersion,sourceRevision,lastAttempt,lastSuccess,coverage,history,sourceEdits}`. Attempts include UTC time, batch, result, row counts or rejection reason. `sourceEdits` includes active count, latest undoable edit ID and whether demo sync is blocked. |
| `GET /api/data/snapshot` | Complete aggregate dataset `{...baseline,cells,cohorts,sourceVersion}`. The browser hydrates its analytics from this versioned server snapshot. |
| `GET /api/workday/report?name=CoreHCM&cursor=0&limit=50&batch=baseline` | Illustrative paginated report with `{report,batch,sourceRevision,rows,nextCursor,total}`; limit 1–200. |
| `POST /api/workday/sync` with `{"batch":"baseline"}` | Replays/restores baseline. Successful response `{changed,status,snapshot}`. |
| Same endpoint with `{"batch":"correction"}` | Replays one synthetic goal-submission correction. Repeating it keeps the same version. |
| Same endpoint with `{"batch":"invalid"}` | Rejects an out-of-range count; the previous snapshot remains active and the failed attempt is recorded. |

`sourceVersion` is the digest of a named synthetic revision plus active cells/cohorts. It is a consistency token, not an external provenance attestation. A question or save against a stale revision receives HTTP 409. The browser must refresh, then repin observations from the new revision. The server calculates from the active snapshot, never from client-supplied numbers.

### Confirmed synthetic source changes

All source endpoints use the existing workspace authentication and same-origin checks. There is one shared editor role: any signed-in editor can inspect the source, apply a known pending proposal or undo the latest active workspace edit. The server supplies a stable workspace-editor identity; clients cannot select an owner. This is not individual identity or a production approval system.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/source/catalog` | Current `sourceVersion`, months/functions/regions, six categories and curated fields `{path,label,category,unit,editable,reason?}`. Protected demographic subdivisions and cohort histories are excluded. |
| `GET /api/source/data?month=2026-09&function=Engineering&region=EMEA&category=cost` | Exact source values with cell identity, path, label, unit and editability. Month defaults to latest; function/region/category may be `all`. Preview is capped at 300 field rows with `totalRows`, `truncated` and `limits` metadata. Unknown filters or catalogue values are rejected. |
| `GET /api/source/history` | Current revision, up to 100 recent source audit entries, current pending proposals, active count and latest undoable edit ID. Internal owner identifiers are omitted. |
| `POST /api/source/propose` | `{expectedSourceVersion,changes:[{month,function,region,path,operation,value}],reason?}`. Returns HTTP 201 and a stored proposal with exact before/after changes and derived totals. Does not change source values. |
| `POST /api/source/apply` | `{proposalId,expectedSourceVersion}`. Applies only the exact stored pending proposal and returns `{changed,edit,status,snapshot}`. No replacement values are accepted here. |
| `POST /api/source/undo` | `{editId,expectedSourceVersion}`. Reverses only the latest active applied edit and returns a newly versioned snapshot and an undo audit entry. |

A proposal allows 1–12 exact cells/fields with `set`, signed `add`, or `scale` operations. Each change must name one existing month, function and region; there is no automatic distribution across `all`. Values must be finite and nonnegative after calculation, at most 10 trillion; counts require integers and currency supports cents. The server calculates arithmetic, reconciles the three cost components into `stock.annualCostRunRate`, and validates the full dataset. Linked partitions and continuity totals are read-only; all other edits must retain applicable ratios and conservation checks. Unknown/prototype paths are rejected.

Employee loaded cost is read-only because it must reconcile to its pay-level allocation; the editor does not invent that redistribution. Average FTE is also read-only because it derives from beginning/ending workforce in this synthetic dataset. Overtime, contractor cost, budget and other eligible fields remain editable. Hiring funnel stages must preserve applications ≥ screened ≥ interviewed ≥ offers ≥ accepted; survey invitations cannot exceed the employee population; regrettable exits cannot exceed voluntary exits. Reported virtual-agent resolutions plus human handoffs must equal sessions, and resolved within-SLA plus outside-SLA cases must equal resolved cases.

Proposal, source snapshot and source audit changes are atomically persisted in `workday-synthetic-state.json`. A local operation queue and PID-owned directory lock serialize writes; a provably dead lock owner can be recovered after a crash. Cloud persistence uses object-generation compare-and-swap. Stale proposals/revisions, duplicate applications and out-of-order undo return 409. Undo creates a new revision even when values match an older snapshot. Demo report sync returns 409 while active source edits exist; it cannot silently replace corrected values. Saved investigations and decision drafts retain their original observations. Source edits affect this synthetic dataset only and never write to Workday or another external system.

## Questions, voice and media

Topic discovery requests can return an additional `discovery` object with `title`, `description`, `sourceVersion`, `scope`, `items`, `views`, `limitations` and a map of trusted `responses` indexed by evidence reference. Items describe observed metrics or hypothetical scenario labs and retain explicit availability, definitions and references. The server constructs this inventory from its governed catalogue, including the existing Economics cost-component chart; model prose cannot introduce executable actions or arbitrary source queries. A response with `savePolicy.supported:false` remains viewable/exportable but cannot be represented faithfully by the current metric-investigation save format. Native metric and scenario saves are unchanged.

Application-owned voice recovery accepts an optional `recoveryTurnId` beginning with `utterance_` only when `recovery:true`. The client creates this after an exhausted recovery receives a fresh explicit discovery request. A new validated identity starts a new two-attempt budget; retired identities cannot be reused, and the existing session-wide delegation cap and ownership checks remain. Long accumulated speech uses the latest complete sentences plus bounded earlier user-history context, rather than permanently rejecting subsequent requests. This is bounded conversational context, not persistent learning or a recording of the whole session.

`POST /api/ask` accepts `{question,scope:{function,region,period},context?,history?,sourceVersion?,audience?,image?,requestId?,operation?,viewContext?,reportContext?,presentationPreferences?}`. `audience` is `chro`, `ceo` or `board` and changes presentation only. History is bounded to 24 messages of at most 2,000 characters each. The common response retains:

```js
{
  mode: 'demo' | 'api', question, answer, title,
  scope: { function, region, period }, sourceVersion,
  action: { type: 'metric' | 'scenario' | 'overview' | 'breakdown' | 'insight' | 'analysis' | 'clarify', metricId, caseId, overrides },
  facts: [{ label, value, note }],
  evidence: [{ id, definition, period, source }],
  followups: ['...'], boundary: '...'
}
```

Demo routing is deterministic and bounded to supported metrics/scenarios. In API mode, server-held `OPENAI_API_KEY` enables a `gpt-6-astra` investigation that can call fixed tools for all 50 metrics, function/region/month comparisons, six scenario calculators, bounded search over definitions and saved evidence, source inspection, presentation requests and non-applying source proposals. The model cannot directly apply or undo source changes. The model composes explanations and proposed actions; deterministic code computes workforce facts. Scope, population, denominator, assumptions, definitions and source revision accompany calculated results. A scenario uses its fixed hypothetical population and complete effective inputs, rather than silently inheriting dashboard filter populations. Unsupported dates, private individual requests and causal claims remain bounded. Explicit `operation:'calculate'` requires a scenario context with assumptions and runs the local calculator without a model request.

API explanations add `analysis:{summary,sections,unknowns,followups}`, `panels:[{id,title,why,response,evidenceRefs}]`, and `evidenceReferences`. Sections have a `kind` of `finding`, `hypothesis`, `recommendation`, `question` or `limitation`, plus a title, text and retrieved reference IDs. Findings must cite retrieved evidence; numeric tokens are checked against that evidence. A bounded repair attempt may correct invalid output; unresolved failure returns an error. These are consistency checks, not a guarantee of semantic or causal correctness. The tool loop allows four investigation/synthesis rounds and an optional fifth verification-only repair with no further tools, sixteen tool calls, and at most six panels. A single-panel response retains its original calculated action; a multi-panel explanation uses `action.type:'analysis'`.

An optional `image:{name,dataUrl}` accepts canonical PNG/JPEG data URLs with matching signature bytes, at most 4,000,000 decoded bytes and 6,000,000 encoded characters. Ask and live-delegation JSON bodies are limited to 8,200,000 bytes. Remote image URLs are rejected. Attachments are unverified user context, not governed findings, and their bytes are not written to the workspace journal. No-key image requests return a configuration error. The UI decodes and scales selected files before sending; there is no camera or video-analysis path.

With a unique 8–100 character alphanumeric/underscore/hyphen `requestId`, the caller can read `GET /api/analysis/progress?id=…`. The response contains bounded phase events and `done`, scoped to the caller's authenticated identity. It is temporary process-local metadata, not a durable job API. Polling does not refresh Cloud Storage. Images, conversation content and analytical records are excluded from progress events. See [docs/ASTRA-ANALYST.md](docs/ASTRA-ANALYST.md) for retrieval, image and operational limits.

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

Chart metadata is passed as `viewContext:{chartId,title,currentType,availableTypes,sourceVersion}`; report metadata uses `reportContext:{reportId,title,currentLayout,availableLayouts,sourceVersion}`. The server validates both structures and rejects stale source versions. `change_chart` and `change_report_view` tools return pending `viewActions`; only the browser's matching-target application can confirm success. Simple supported typed/voice controls can run directly in the application without a new analytical request. Source-only answers may include `sourceOnly:true`, `sourceData` and/or `sourceEditProposal`. Proposing is never confirmation to write; the user must apply the visible exact proposal through its button or an explicit supported confirmation utterance.

Charts preserve raw values, scope and source revision when switching between bar and line. Categorical line charts state that category order is not a time trend. Pie is restricted to nonnegative, complete, nonzero additive partitions: the three workforce-cost components or demonstrably disjoint headcount/cost function/region comparisons. Rates, time-series stocks, suppressed/missing values, negative rows and overlapping scenario economics do not support pie. Unsupported choices retain the current chart and explain why.

Report views are `executive`, `evidence` and `full`; they change visibility/layout of existing content without regenerating facts. The browser can remember chart-family/report-layout preferences after two matching choices, using the local-storage key `wi.presentation-preferences.v1`. At most 16 chart-family preferences are retained; users can reset them from the header. `presentationPreferences` contains only these bounded display choices. There is no model training, personal profile inference or persistent transcript learning. Spoken assistant captions remain hidden; internal transcript events can still drive approximate evidence highlighting. See [docs/ASSISTANT-ACTIONS.md](docs/ASSISTANT-ACTIONS.md) for the application flow and implementation boundaries.

Authenticated GET /api/studio/bootstrap returns {response,catalog}: a deterministic executive overview plus all 50 metric IDs, labels and definitions. It never calls a model. The Studio adds six scenario entries to this catalogue.

/api/ask accepts bounded conversation context: metricId, caseId, validated overrides, insightId, sourceVersion and pendingAssumption for a retention-unit clarification. A stale context revision returns409, even if the outer sourceVersion is current. Supported deterministic follow-ups reuse explicit scenario assumptions; only the requested fields change. API questions use the analytical tool loop and preserve current scenario assumptions when revising the same case unless the user asks to reset. In demo mode, unsupported compound steps produce a clarification instead of silently executing a subset.

Answers add conversation plus presentation:{version,scene,headline,takeaway,beats,nextQuestions,sourceVersion,chart?}. Beats reference answer fact indexes and evidence IDs. Scenario chart rows come from the same server calculator. Explicit supported compound requests add workflow, an ordered array of complete answers. No presentation field authorizes saving, approving or executing decisions.

Live delegation preserves event for compatibility and adds up to8 bounded events. The browser sends subsequent narration only after the matching injection acknowledgement. An acknowledgement does not indicate audio playback completion. New speech, explicit navigation, scope changes and Stop invalidate pending analysis and queued narration. Transcript-based emphasis is approximate. Studio changes no saved-state schema, credentials or approval status.

### Interrupted-question recovery

Continued input can cancel a pending delegated lookup or its 300 ms transcript drain. If no replacement provider delegation arrives, a 900 ms quiet timer can submit the complete available transcript to the existing authenticated `POST /api/live/delegate` endpoint with `recovery:true` and a `delegationId` beginning `recovery_`. The flag must be boolean; recovery IDs must meet the existing ID rules and required prefix. Session-cookie ownership is enforced before any analytical work, including recovery.

The HTTP result retains `sessionId` and the application correlation `delegationId`, adds `recovery:true`, and returns bounded commentary events with `delegation_id:null`. This distinguishes application-triggered transcript work from an actual provider delegation. The browser checks both the wrapper identity and the expected provider correlation form before accepting a result. A normal provider redelegation cancels the recovery timer or supersedes active recovery. Duplicate IDs remain rejected.

The browser and server bound consecutive unsuccessful application recoveries to two, resetting after a successful result or a normal provider delegation. Exhaustion or an analytical failure produces a visible retry instruction while retaining Stop for the active voice session. Stop/release clear recovery timers and abort active work; source refresh ends the voice session. Typed questions, explicit navigation, scope and attachment changes discard queued recovery and obsolete transcript context. Delegations at or before the consumed/discarded transcript offset are ignored before changing active work or narration.

Recovery changes neither numerical validation nor saved-state approval status. Its quiet timer does not guarantee an accurate or complete transcript, and commentary acknowledgement still confirms injection rather than completed audio playback. Simulated browser/HTTP regression evidence is in [docs/voice-recovery/report.json](docs/voice-recovery/report.json); actual provider and physical media verification must be recorded separately.
