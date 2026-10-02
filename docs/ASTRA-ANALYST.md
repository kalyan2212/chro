# Astra analytical workspace

The configured Studio now asks Astra to investigate and explain a question using governed, read-only tools. It can retrieve several measures, compare functions or regions, inspect trends, test a scenario, consult workspace definitions, and compose a briefing that separates evidence, hypotheses, proposed actions and unknowns. The no-key demo retains its deterministic question routes. Neither mode connects to real employee records or approves an employment action.

## Use the experience

Open Studio at `/`, select a CHRO, CEO or Board perspective, and ask a question. For example: “Compare Engineering and Sales workforce costs, explain the supporting signals, and recommend what to investigate first.” Perspective changes the explanation's emphasis; it does not change facts or access rights. **Workspace**, or `/?workspace=1`, returns to the original Monitor → Investigate → Decide interface.

During analysis, the status describes the current step and tool category. The completed briefing distinguishes findings from hypotheses and recommendations. Evidence reference buttons open the associated calculated panel or a reference explanation. Panels retain their scope, source revision, definitions, chart and scenario assumptions. Selecting a panel adopts its scope for follow-ups; editing a scenario's assumptions explicitly recalculates with the local engine. Manual panel, perspective and attachment changes cancel pending typed analysis so its late response cannot replace the selected context.

Use the attachment button to select a PNG or JPEG chart or screenshot. The browser accepts a file up to 12 MB, decodes it, reduces its longest side to at most 1,600 pixels, and sends a JPEG representation with the question. The server independently validates the attachment. The image remains user-provided, unverified context; its contents cannot become governed workforce evidence merely because Astra can describe them. Remove the preview when subsequent questions should no longer include it. Image interpretation requires configured Astra API access. There is no live camera or video analysis.

Continuous voice delegates analytical questions to the same server path and can include the selected perspective, current scene, recent conversation and attachment. The displayed briefing and related evidence can receive emphasis during narration. This emphasis follows approximate transcript or playback progress; it is not word-accurate alignment. A transport acknowledgement confirms that a narration injection was accepted, not that the audio finished playing. Microphone permission, browser audio behavior and provider access remain distinct dependencies.

## Calculation and evidence boundary

`analyst.mjs` runs a bounded Responses tool loop. It supplies the workspace catalogue, selected scope, current context, up to 24 recent messages, and any attachment as user context. The model may call several tools and request more evidence after inspecting an earlier result. Current limits are four investigation/synthesis rounds, an optional fifth verification-only repair with no additional tools, sixteen tool calls per question, and six rendered evidence panels. These are execution limits, not a fixed vocabulary of supported strategic questions.

`evidence-tools.mjs` provides five fixed functions:

| Tool | Available evidence |
| --- | --- |
| `inspect_metrics` | One to twelve of the 50 metric definitions and calculated observations in a validated scope. |
| `compare_metrics` | One to six measures split by function, region or month, with the engine's periods, units and suppression rules. |
| `calculate_scenario` | One of six local calculators with validated, typed assumptions and explicit hypothetical populations. |
| `search_workspace` | Bounded keyword search over metric definitions, 38 view descriptions, scenario methods, shipped reference explanations and allowlisted saved investigation/decision fields. |
| `get_scenario_catalog` | Scenario methods, default inputs, input bounds and calculation limits. |

Each retrieved item receives an immutable request-local identifier such as `E1`, a source version and a scope where applicable. Computed evidence retains the full trusted engine response. The engine restores the question's snapshot immediately before each synchronous calculation. Model arguments never become executable code, SQL or arbitrary filesystem paths. Search reads only fixed, size-bounded shipped files and explicitly supplied saved records; it does not read `.env`, arbitrary `.state` files or the local filesystem on demand.

The final structured answer contains a headline, summary, typed sections, unknowns, follow-ups and evidence panel requests. Findings must cite retrieved identifiers. Numerical tokens in findings are checked against their cited calculated evidence, including signs and units; invalid explanations may receive a bounded repair attempt and otherwise fail visibly. Panels must point to an actual engine response. These checks catch several forms of fabricated arithmetic and invalid citation, but do not prove every claim, interpretation or causal inference correct. Human review remains necessary.

The tool catalogue exposes all 50 metric definitions and all 38 mapped views. Some views are gated, suppressed or definition-only. Search returns at most ten bounded matches, history is finite, and a question has a fixed work budget. Therefore the application does **not** claim 100% website understanding, exhaustive retrieval, unrestricted analytics, causal attribution or a reliable answer to every question. This implementation uses a tool-driven catalogue and local keyword retrieval; it has no vector database or separate DAG orchestration layer.

## HTTP and lifecycle

`POST /api/ask` accepts the existing question, scope, context and source revision, plus optional `audience`, `image`, `requestId` and `operation`. With an API key, ordinary questions use the analyst. `operation:"calculate"` requires an explicit scenario and assumptions and runs the deterministic calculator. A no-key request with an image fails clearly instead of claiming visual understanding.

`GET /api/analysis/progress?id=…` returns bounded in-process phase metadata only to the identity that created the question. It carries no image, transcript or analytical document and does not refresh Cloud Storage on each poll. It is temporary progress feedback, not durable job state or a cross-instance queue. A stale source revision, including stale conversational context, returns HTTP 409; the server also checks for source changes before accepting completed analysis.

The ask and voice-delegation endpoints allow JSON bodies up to 8,200,000 bytes. The server accepts canonical PNG/JPEG data URLs only, with matching signature bytes, a decoded limit of 4,000,000 bytes and an encoded-string limit of 6,000,000 characters. It rejects remote image URLs and active image formats. This checks payload bounds and type signatures, not a complete image decoder or comprehensive file-malware scan. The browser decodes and re-encodes its selected file before sending it.

Images and conversation history are submitted to the configured provider as necessary for the request; the Responses request sets `store:false`. That parameter does not establish an organization-specific retention or compliance policy. The application does not persist attachment bytes or full conversations in its workspace journal. Progress is process-local. Existing journal persistence retains source revisions, explicitly saved evidence/notes, decisions and bounded audit metadata.

Investigations and decision drafts still require the user's Save action. The server validates the active revision and reconstitutes calculated evidence. Pins retain each panel's scope; breakdowns also preserve displayed segment observations within the 50-pin bound. Downloaded briefs map evidence reference IDs to their scope, revision, facts and definitions. Saved records are immutable, deduplicated snapshots; decisions remain `draft-unapproved`. The analyst has no email, write, approval or deployment tool and cannot silently execute a recommendation. Saved notes and document excerpts are treated as untrusted content, not instructions that override the tool boundary.

## Validation boundary

The deterministic test suite covers catalogue breadth, all metric agreement, scenario calculations, sensitive-cell suppression, snapshot isolation, cited analysis, numerical rejection/repair, image limits, progress ownership, cancellation and voice state handling. Browser regressions exercise the original workspace and Studio. Mocked providers establish application behavior, not actual model capability or physical audio performance. Current results, separate real-provider trials and remaining presentation-device checks are recorded in [VALIDATION.md](../VALIDATION.md).

All workforce data remains synthetic. Real deployment still requires approved data integrations, reconciled metric definitions, individual identity and entitlements, retention policy, and human governance. The shared workspace password and presentation perspective selector are not enterprise authorization.
