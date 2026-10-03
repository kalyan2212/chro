# Assistant actions and source editing

Studio can change the presentation of visible evidence and prepare exact changes to the stored synthetic source. These are separate application capabilities. Changing a chart or report does not change a number; applying a reviewed source proposal does.

## Chart and report controls

Open a chart and choose **Bar**, **Line** or an available **Pie** control. Supported typed and voice chart commands use the same controller. A categorical line includes a non-trend caption, and exact values remain available alongside its marks. A pie is available for complete nonnegative cost components and demonstrably disjoint headcount/cost breakdowns by function or region. Rates, suppressed values, negative economics, monthly workforce stocks and overlapping scenario outcomes cannot be shown as a pie. The current chart remains intact when a type is unavailable.

Analytical briefings offer **Executive**, **Evidence** and **Full** views. They rearrange or hide existing sections; they do not generate a new report or alter its findings. **Open full evidence and reasoning** restores the full report. Assistant speech remains audible without visible spoken captions; the written briefing, source references and evidence highlighting remain on screen.

The current chart/report identity and source revision accompany a requested change. The browser verifies that the target still matches before applying it. The model's tool result is a request, not proof of success. Local controls do not need a new model calculation, while an unfamiliar natural-language instruction may still use the analyst tool loop.

## Remembered display preferences

After two matching choices, this browser can remember a chart type for the relevant chart family or a report layout. **Your display preferences** lists these choices and provides **Reset preferences**. Up to 16 chart-family choices and one report-layout choice are stored in `localStorage` under `wi.presentation-preferences.v1`.

This is display preference storage only. It does not train a model, infer personal attributes, persist conversations, or edit source data. The bounded preference object can be included in the next analytical request so the assistant understands the current presentation. A remembered pie preference is applied only when the new chart supports pie.

## Inspect, propose, apply and undo

1. Select **Source data** and choose a month, function, region and category. Browsing can include all functions or regions; it shows actual aggregate source values with their units and editability. Broad previews stop at 300 field rows and explicitly report truncation.
2. Select **Edit** beside an editable field, or ask for a change using a specific source cell and value. For example, identify Engineering, EMEA, September 2026 and external contractor cost. The application does not silently allocate a company-wide request across cells.
3. Review the exact **Before** and **After** values. A cost component change also shows the derived annual workforce-cost total. A proposal is persisted for review but leaves the active source unchanged.
4. Apply the visible proposal with **Apply these changes** or a supported explicit confirmation. The server commits the stored values, writes an audit record and creates a new source revision. The client refreshes its source dataset; saved investigations retain their original evidence.
5. Undo the latest active source edit using its ID and current revision. Undo restores its prior values but creates a new revision and audit entry. Earlier edits can be undone only after later active edits have been reversed. Persisted source history makes confirmed operation IDs available after a reload or an interrupted response.

All changes affect the fictional synthetic dataset served by this application. There is no external Workday writeback, payroll change or personnel action. The shared-password application has one editor role: **any signed-in editor can apply a known proposal or undo the latest workspace edit**. This is not a system of individual approvers.

## Source boundaries

The catalogue has six categories: cost, workforce, hiring, talent, listening and service. It exposes only curated aggregate fields. Protected demographic subdivisions, cohort histories and individual records are not exposed by source-inspection/edit tools.

Overtime, contractor cost, budgets and other eligible aggregate fields support exact `set`, signed `add` and multiplicative `scale` operations. The server computes the result; it accepts 1–12 distinct field/cell changes in a proposal, finite nonnegative resulting values up to 10 trillion, whole-number counts and currency to cents. Direct currency assignments with extra decimal places are rejected; arithmetic currency operations are rounded to cents.

`stock.annualCostRunRate` is derived from employee loaded cost, overtime and contractor cost. Editing overtime or contractor cost recalculates that total. Employee loaded cost is read-only because its pay-level allocation must also reconcile; the application will not invent a distribution across levels. Average FTE is read-only because it derives from beginning/ending workforce in this synthetic source. Workforce continuity totals, linked distribution totals and some linked hiring/service fields also require a complete validated source import.

Other changes preserve applicable population and conservation checks. Hiring funnel counts remain ordered from applications through accepted offers. Survey invitations cannot exceed employees, and regrettable exits cannot exceed voluntary exits. Changing resolved cases within SLA requires a matching change to resolved cases outside SLA; reported virtual-agent resolutions and human handoffs must together match sessions. A rejected proposal leaves the source unchanged.

Every apply/undo requires the current `expectedSourceVersion`. A stored proposal from an earlier revision cannot be applied, even if the caller supplies a newer version. Repeated application and undo out of order return 409. Active edits block demo baseline/correction sync so a refresh cannot silently overwrite them. Undo all active edits before replacing the source with a demo batch.

## Implementation and endpoints

`source-edits.mjs` owns the explicit field catalogue, bounded inspection, path validation, deterministic change arithmetic and derived totals. `workday.mjs` owns persistent proposals, snapshot validation, atomic application and undo, and the source audit. Snapshot and audit updates share one `workday-synthetic-state.json` commit. Local writes use an operation queue and an atomically published PID-owned lock. A live lock owner is not displaced; a provably dead owner can be recovered. Cloud Storage uses object-generation compare-and-swap instead.

`evidence-tools.mjs` exposes `inspect_source_data` and `propose_source_changes` alongside fixed analytical tools. It exposes `change_chart` and `change_report_view` as pending presentation requests. It does not give the model an apply/undo tool. `public/assistant-actions.js` owns browser controls, display preferences and confirmed source HTTP requests. `public/studio-charts.js` owns immutable chart rendering, chart identity and chart-type eligibility.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/source/catalog` | Current source dimensions and curated editable/read-only fields. |
| `GET /api/source/data` | Bounded source field rows for selected filters. |
| `GET /api/source/history` | Recent audit entries, pending proposals and latest undoable ID. |
| `POST /api/source/propose` | Store a validated exact before/after proposal. |
| `POST /api/source/apply` | Commit the named pending proposal against its exact source revision. |
| `POST /api/source/undo` | Reverse the latest active edit against the current source revision. |

These routes use the application's existing authentication, origin restrictions and bounded JSON bodies. Internal owner identifiers are omitted from public proposal/history responses. An interrupted network response does not prove whether a write committed; inspect current source history before retrying. The version/proposal guards reject duplicate commits.

## Verification boundaries

`test/source-edits.test.mjs` uses isolated temporary state and a simulated cloud object store. It covers exact contractor-cost reconciliation, recalculated scoped/company cost metrics, unchanged data during proposal, restart persistence, undo, stale revisions, owner/path/numeric guards, local/cloud write races and dead/live local-lock ownership. It does not alter the developer's `.state`.

`scripts/check-chart-types.mjs` exercises the real local application in Chromium with synthetic data and no provider calls. Its screenshots in `docs/chart-types/` cover line and pie at 1920×1080 and 390-pixel width, plus refusal of a negative-value pie. These checks establish browser rendering and action behavior, not real microphone recognition or provider latency. Integrated regression and actual provider/media results are recorded separately in [VALIDATION.md](../VALIDATION.md).
