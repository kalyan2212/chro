# Release validation — version 2.0.1

The dated entries below preserve release history. See **Astra analytical workspace — October 2, 2026** for the current tool-driven analyst, image and browser validation boundary.

Built and checked on 25 September 2026 with Node.js 24.19.0. **83 automated tests passed**, plus the six-step offline preflight. The previous 2.0.0 release also passed a separate CLI startup/shutdown smoke check. No live OpenAI or Anthropic request, company-system request, physical microphone recording, or browser-rendered visual review was performed in this environment. For this patch, the user's supplied diagnostic JSON reported a passed local capture test; the supplied WebM contained VP8 video and Opus audio and decoded without errors. That establishes local diagnostic capture, not an AI voice session.

This is the complete runnable **synthetic demonstration package**. Its frontend, local backend, simulated source adapter, persistent decision workspace, and optional provider integration paths are implemented. A functioning implementation and mocked protocol checks do not establish real model entitlement or target-device media behavior.

## Reproduce the local checks

```sh
npm test
npm run preflight
npm run preflight -- --output preflight-results.json
```

The default preflight starts an isolated temporary server and blocks external model requests even if keys are present in the environment. It leaves the main workspace state unchanged. Machine-readable results from this build are included in `docs/offline-preflight.json`.

| Area | Verified evidence |
| --- | --- |
| Product coverage | All eight embedded analytics scripts load. The 38 People/HR Operations measures and all six visual decision labs render under a Node DOM stub. This is functional content coverage, not browser layout validation. |
| Numerical agreement | All 50 inspector values match the answer engine across enterprise and representative function/region/month scopes. Retention downside, cohort denominators, queue conservation, readiness, opportunity cost, funding and delay units are checked. |
| Synthetic Workday adapter | Seven paged reports reconstruct 240 monthly aggregate cells and 20 mature cohort rows. Duplicate/missing rows, invalid counts, continuity and accounting mismatches reject the batch. Correction replay is idempotent; failed input retains the previous snapshot. |
| Source consistency | A correction adds 17 Engineering/EMEA September goal submissions; P07 and the server-injected dashboard snapshot agree. Stale source requests receive 409. A committed browser refresh clears the old answer/history; pending filter changes cannot be overwritten by old responses. |
| Saved decisions | HTTP tests save and reload a downside scenario, observed context, pinned evidence and captured assumptions. The server replaces forged client figures with calculated results. Drafts and review survive restart; repeated saves do not duplicate a draft. |
| Review | All six cases have a deterministic method review. Mocked Claude tests check authentication, explicit model choice, structured output, quoted untrusted notes, refusal of invalid output, configuration failure and bounded inputs. Reviews do not change arithmetic. |
| Voice protocol | Mocked GPT-Live tests cover the documented WebRTC session envelope, transcript assembly, client delegation, exact decimal/negative facts, interruption, stale-result rejection, autoplay handling, closing and cleanup. The toolbar opens without microphone capture and retains a finishing indicator during closure. |
| Voice failure diagnosis | A local HTTP reproduction of a nested TLS fetch failure now returns `TLS_TRUST`, a safe stage and a correlation ID. Tests cover DNS/network/state distinctions, malformed keys, HTTP/quota/parameter metadata, redaction, bounded reports, timeout, authentication and origin protection. A mocked HTTP 200 proxy page fails the metadata check. A post-allocation journal failure triggers session cleanup. This does not establish that TLS caused the user's failure. |
| Connection help | DOM tests confirm that a failed startup releases the microphone and peer connection, opens help, downloads safe failure context and permits retry. The metadata check does not capture a microphone or create a voice session. This is not a hardware-browser or live-service test. |
| Turn-based media | DOM/media mocks cover delayed microphone permission, cancellation, stale recorder isolation, transcription submission and bounded actions. Canvas text checks retain all six facts, full assumption text and the negative retention result. These are not codec or physical playback checks. |
| HTTP and workspace access | Actual local HTTP tests check public assets, allowed hosts/origins, method/body/type limits, timeouts, shared-password sign-in/logout and per-cookie voice-session ownership. Keys and whole transcripts are absent from returned audit metadata. |
| Startup and shutdown | The documented Node entry point loads a temporary `.env`, serves password-protected synthetic answers, uses disk state and exits cleanly on SIGTERM. A regression test waits for pending voice cleanup before declaring shutdown complete. |
| Container configuration | Compose YAML was parsed and publishes the service to host loopback. Docker was unavailable; the image build and runtime were not exercised. |

The test suite substitutes external providers with deterministic stubs and dummy keys. Tests deliberately contact only their local HTTP servers. Assertions about rendered content or fake MediaRecorder calls do not certify visual layout, microphone hardware, codec support, latency or actual speech fidelity.

## Verify external services and the presentation machine

The following checks can only run after credentials and the intended browser/device are available. They are supported by the included code; they are not represented as already passed.

1. Set `OPENAI_API_KEY` on the server and run `npm run preflight -- --live`. It requests test speech, transcribes that generated audio, routes the question through Astra, and generates answer narration. This explicitly makes four paid API requests. It does not test a physical microphone, WebRTC or WebM playback.
2. For optional Claude review, set both `ANTHROPIC_API_KEY` and an available `ANTHROPIC_MODEL`, then run `npm run preflight -- --claude`. This explicitly makes one paid review request. Both flags may be combined.
3. Open **Connections & readiness → Test microphone & video** on localhost or HTTPS. Check permission approval/denial and download the diagnostic WebM/JSON. The diagnostic has a generated tone, not spoken analysis; it does not open the camera.
4. Use **Ask Workforce → Speak → Stop**. Verify the captured question, scoped facts, generated answer voice and manual Play fallback after blocked autoplay. Confirm the microphone stops after completion, cancellation and the 60-second limit.
5. Open **Continuous voice → Connection help → Check API connection**, then **Start conversation**. The first step is a metadata-only diagnostic and does not prove a working voice session. Ask a metric question, ask the 0.5 pp retention downside, interrupt, mute, and stop. Compare the spoken numbers with the evidence card. Confirm `session.closed` or an explicit unconfirmed-finalization message; do not infer final billed duration from a REST hangup response. If startup fails, download the connection report before restarting the server; see [docs/VOICE-TROUBLESHOOTING.md](docs/VOICE-TROUBLESHOOTING.md).
6. Save a narrated WebM from the governed answer. Play the downloaded file separately and confirm readable facts, complete narration, audio and video tracks, correct negative net value, and no microphone/camera content. If needed, inspect tracks with `ffprobe -show_streams workforce-briefing.webm` on your machine.
7. Rehearse the guided board path in the target browser/projector: Monitor, a scoped investigation, pinned evidence, a downside lab, saved decision, review, JSON and board-brief export. Check keyboard focus, narrow screens and print output.

## Exact release boundary

Included: synthetic source integration, versioned snapshots, the local decision engine, the complete UI source, API adapters, continuous and recorded-voice clients, narrated-video code, diagnostics, persistent drafts/audit metadata, shared-password access, launch scripts, Docker configuration, tests and documentation.

Not supplied: actual company connectors/credentials, API entitlement, production hosting, enterprise SSO/RBAC, individual employment decisions, approval execution, a generated avatar, camera analysis or verified live media performance. The current video output is an evidence-card recording with AI narration. This release is suitable for preparing and rehearsing a synthetic demonstration; production and board-machine acceptance must be established in the environment where it will run.

## Continuation verification — 28 September 2026

The earlier release evidence above is retained as history. The current in-place continuation passed **84 automated tests** and all six offline preflight checks on Node 24.14.0. Chromium browser automation and repeated screenshot inspection were subsequently performed at 1920 × 1080, plus responsive interaction checks at 1366, 768 and 390 pixels wide. Verified behavior includes saved investigations, source lineage and stale-pin rejection, decision handoff, all eight briefing steps, all six scenario visualizations, and simulated microphone-denial recovery. No real provider or physical media verification is claimed. Full evidence and remaining checks: [docs/CONTINUATION-REVIEW.md](docs/CONTINUATION-REVIEW.md), [browser results](docs/browser-review.json).

## Cloud persistence continuation — 28 September 2026

The expanded suite passes 88 tests, including Cloud Storage generation checks, concurrent journal writes, restoration in a new runtime, and preservation of confirmed state after a failed write. The existing local source and workspace objects were copied to the private GCP bucket and successfully read back. Browser inspection and screenshots are recorded separately in `docs/CONTINUATION-REVIEW.md` and `docs/REDESIGN.md`; the historical release statements above describe the earlier release only. See `docs/DEPLOYMENT-GCP.md` for cloud deployment status and limits.


## Intelligence Studio — October 1, 2026

The release passed **127 automated tests**, **18 Studio browser checks**, **6 simulated voice browser checks**, and the existing13-journey workspace browser regression plus narration/shared-link checks. Screenshots were inspected at1920×1080 and390px, with responsive checks also at1366 and768px. Verified flows include context and assumption retention, all six calculated charts, percent-unit clarification, compound-step integrity, Back, persistent investigation/decision saves, original lineage, source refresh, reduced motion and access to the original workspace. See [Studio report](docs/studio/report.json) and [voice protocol report](docs/studio-voice/report.json).

A separate **real-provider** trial used generated speech input through WebRTC. It transcribed the retention question, opened the matching scene, spoke six avoided exits and minus $90,000 net, received measurable audio, and closed with final24.0-second provider usage. [Sanitized evidence](docs/studio-voice/provider-report.json). This does not establish physical microphone/speaker compatibility, exhaustive question coverage or production HR governance. Saved records remain drafts, all data remains synthetic, and transcript emphasis is approximate.

## Astra analytical workspace — October 2, 2026

The current integrated application passed **155 automated tests** and **six offline preflight checks** on Node 24.14.0. The only legacy test fixture requiring adjustment was the live-session ownership test: its old router response was replaced with a real tool-call/structured-answer fixture. All cookie ownership, rejected cross-session access, duplicate delegation and logout cleanup assertions remain. The new test also requires retrieval of governed headcount evidence. No external provider requests were made by these tests or offline preflight.

The suite now checks multi-step analyst execution, all 50 metric definitions and calculated values, 38 coverage descriptions, scenario assumptions, small-cell suppression, snapshot isolation, numerical grounding and repair, unknown references, bounded tool calls, image validation and size limits, progress ownership, and cancellation. HTTP tests confirm that large voice-delegation bodies still require the owning session, the close endpoint retains its smaller limit, and progress polling does not trigger Cloud Storage reads. These tests establish deterministic application behavior with simulated provider responses; they do not establish comprehensive reasoning quality.

The five existing Chromium scripts passed again: **13 original workspace journeys**, shared-link sign-in, the narration guide, **18 Studio checks**, and **six simulated voice checks**. They cover persistent investigations and decisions, evidence lineage, stale-source recovery, the six labs, assumptions and follow-up context, Back navigation, narrow layouts, reduced motion, expired authentication, microphone denial and stale narration cancellation. Their generated historical screenshots were not used to make a new visual-quality claim.

The new [analyst browser report](docs/analyst/browser-report.json) records **16 checks** using a recorded actual Astra response and locally calculated scoped observations as fixtures, with no external API calls during browser execution:

1. Board perspective is sent with the question and the recorded analysis renders findings and calculated panels.
2. Selecting an evidence panel changes the visible chart and follow-up context.
3. A claim citation navigates to its associated calculated panel.
4. Downloaded briefs map evidence reference IDs to their scope, revision and metric definitions.
5. Narration cues highlight a finding and its panel, then clear on stop.
6. A saved panel investigation survives reload with server-calculated lineage.
7. Saved breakdowns retain displayed Engineering and Sales segment observations, rather than only the aggregate.
8. An attached image is decoded, normalized, previewed and sent only while attached.
9. Changing perspective aborts an active typed request and rejects its late response.
10. Adding or removing an attachment aborts stale typed analysis.
11. Leaving Studio keeps a hidden Studio attachment out of Workspace voice.
12. Manually selecting evidence aborts pending analysis while retaining the selected panel.
13. A multi-panel save retains each observation's separate scope, server-calculated value and source revision.
14. Follow-ups use the selected panel's scope as well as its metric context.
15. Layouts fit at presentation, tablet and phone widths, and reduced motion is honored.
16. No browser JavaScript errors occur.

The new briefing screenshots were inspected at 1920 × 1080 and 390 pixels wide; the chart was kept visible within the desktop evidence panel after an inspection-driven layout correction. See [desktop briefing](docs/analyst/01-executive-1920.png), [narration emphasis](docs/analyst/02-narration-focus-1920.png), and [phone briefing](docs/analyst/briefing-390.png). These images show one recorded analysis, not exhaustive evidence of every generated answer or device.

GitHub Actions now runs `scripts/check-analysis.mjs` after the existing browser suite using the same installed Chromium. Its response fixture is checked into the repository and it makes no live provider calls. The live preflight has been updated to accept a structured analysis with cited headcount evidence and a longer analytical request deadline; its changed **live** branch has not been rerun as part of the offline checks above. Live analysis may require multiple paid Responses requests, so the earlier fixed four-request preflight description is historical.

Actual provider validation now includes **four successful Astra analytical paths**, recorded in the [sanitized provider report](docs/analyst/provider-report.json): a multi-metric executive question (34.7 seconds, two Responses rounds), a strategic follow-up carrying prior conversation (43.3 seconds, two rounds), image reconciliation against governed workforce metrics (29.0 seconds, two rounds), and staffing-versus-automation experiment design (59.2 seconds, three rounds). The model retrieved calculated evidence and composed distinct findings, hypotheses, recommendations and limitations. These are measured samples, not latency guarantees or exhaustive reasoning-quality certification.

The successful image response retained the supplied **8.0%** Engineering label as an unverified visual observation, separately cited the governed **7.0%** result, and described the discrepancy without inventing its cause. Earlier failed trials are preserved in the report: the first image answer mixed image and governed numbers in a finding; the initial service comparison exposed a verifier omission of valid chart timings and effective monetary assumptions. Those failures were corrected and the final image and service replays passed without a repair round. Separately, an [actual browser-to-application image check](docs/analyst/local-http-report.json) completed in **37.6 seconds** through authenticated local HTTP endpoints, rendered the analysis and evidence canvas, and recorded no browser JavaScript errors.

An [actual continuous-voice replay](docs/analyst-voice/retest/provider-report.json) completed both the staffing-versus-automation question and a follow-up asking how to distinguish capacity from routing. The model revised its recommendation when the follow-up changed the decision framing; calculated evidence and received spoken answers were present for both turns. These generated-input WebRTC trials took **81.6 and 67.1 seconds** from spoken-question start to analysis, with substantive speech following about one second later. This delay is a material interaction limitation.

A subsequent concise voice profile preserves the complete tool catalogue, medium reasoning and numerical verification while requesting a shorter summary and fewer displayed sections. One [actual direct analytical replay](docs/analyst/voice-profile-report.json) of the service question completed in **29.3 seconds**, two provider rounds, with four short sections, two scenario panels and eight evidence references; the earlier full-length direct replay took 59.2 seconds in three rounds. This is a sampled backend improvement, not a controlled comparison or an established end-to-end WebRTC latency guarantee. Physical microphone/speaker compatibility, exact word-to-visual synchronization, complete question coverage and production HR governance remain unverified. Architecture and operational limits are documented in [ASTRA-ANALYST.md](docs/ASTRA-ANALYST.md).

Final implementation regression run: **160/160 automated tests passed**. The 16 analyst browser checks cover presentation, source references, persisted scopes, exports, attachment and perspective cancellation, and responsive layouts. Actual provider and continuous-voice reports above remain distinct from simulated browser checks.

Hosted follow-up (2 October): release d5a6190 loaded with matching assets, all prior saved records unchanged and no browser errors. Two continuous-voice questions completed in 36.4/35.4 seconds to analysis, with substantive audio about one second later and final closure/microphone release confirmed. The check exposed a transcript-tail reuse defect and an ambiguous observed-versus-modeled population paraphrase. The subsequent patch captures the consumed transcript end and puts the independent scenario population first in narration. **162/162 automated tests** and all six simulated voice browser checks pass after that patch; final hosted speech verification is recorded separately.

The analyst browser suite now passes **17 checks**, including direct assumption recalculation while a chart remains attached: the image is retained for analytical questions and excluded from the local arithmetic request.

Voice recovery release: **170/170 automated tests**, ten independent recovery browser checks and six existing simulated voice checks pass. A real local session deliberately continued a question after the first lookup began: the application automatically answered the complete question using documented null-delegation commentary, then answered the next question without transcript-tail reuse. Both questions matched their recognized transcripts; responses arrived in 44.8/34.2 seconds and audio followed in under one second. Final voice usage was 133 seconds. Spoken wording explicitly distinguished observed and hypothetical populations, while the full opening-count detail remained on screen. See docs/voice-recovery/live-report.json and live-1920.png; generated input is not physical microphone verification.

## Caption-free voice and response efficiency — October 2, 2026

Assistant speech captions have been removed from Studio, the analysis canvas, the classic evidence guide and the Live panel. The final **172/172 automated tests** pass. The 18 Studio, 17 analysis, six simulated voice and classic desktop/mobile guide checks pass with assertions that a spoken-only marker never appears in the visible DOM. Internal assistant transcript events, written evidence, topic highlighting, interruptions, errors and Stop remain functional. All ten recovery browser checks also pass. The updated 1920-pixel narration screenshots were inspected after capture.

The model-facing catalogue and tool results now omit repeated UI structures, and scenario arguments omit unrelated cases' null inputs. Full evidence and all 50 metrics, 38 views and six scenarios remain available. A [same-question backend comparison](docs/analyst/latency-report.json) measured 35.150 seconds before, 37.279 seconds after the first compaction, and 33.591 seconds with case-specific tool arguments. An unsuccessful network trial is retained. These samples show a modest final improvement and considerable variability; they do not establish a general latency guarantee. A subsequent prompt asks for independent lookups together.

One [actual local voice trial](docs/voice-performance/live-report.json) with that integrated prompt completed the service comparison in 31.167 seconds from speech start, or 25.407 seconds after the generated question ended. Substantive audio followed analysis by 1.044 seconds. There were no assistant-caption elements, while 97 internal transcript events still drove evidence focus and scrolling. Actual output audio was measured; no browser or protocol errors occurred. Final 82-second usage, ended microphone tracks and closed peer connections were confirmed. The narration described an independent hypothetical queue and conditional results; the opening count remained visible in the chart. See the [captured presentation view](docs/voice-performance/live-1920.png). This generated-input trial does not test physical microphone or speaker hardware.

## Conversation-centered home and automatic welcome — October 2, 2026

Studio now presents its single conversation form in a prominent right-side home panel, with an animated voice indicator, connection state and primary voice control. Evidence scenes retain the existing floating composer. The layout was inspected at 1920×1080 and 390 pixels wide, with additional 1366/768-width checks. The home form is not fixed to the bottom, and reduced motion disables the orb animation. See the [home screenshot](docs/studio-home/home-connected-1920.png).

The final **185/185 automated tests** pass, along with **12 new home browser checks**, 18 existing Studio checks, 17 analytical checks, six simulated voice checks and ten recovery checks. The [home browser report](docs/studio-home/report.json) covers automatic startup, one welcome request, Stop, no automatic reconnection, denied/ignored microphone permission, audio recovery, late capture cleanup, hidden-page closure, the explicit `?voice=manual` opt-out, responsive layout and typed-question navigation. Permissions, playback and transport are simulated in this browser suite; it makes no provider calls.

A separate [real-provider welcome trial](docs/studio-home/live-welcome-report.json) used Chrome's native simulated silent microphone, microphone permission granted in advance, default autoplay policy and no page click or spoken question. Voice connected 4.202 seconds after navigation, and the actual spoken welcome began at 5.179 seconds. It introduced Workforce Studio, its synthetic data and exploration options. Measured output audio, zero visible assistant captions, no analytical lookup and no browser/provider errors were confirmed. Stop closed the connection and microphone tracks; final provider usage was 22 seconds. See the [actual welcome screenshot](docs/studio-home/live-welcome-1920.png).

An earlier real trial connected but stayed silent: waiting for playback before requesting the first speech created a circular startup dependency. The corrected flow requests an application-owned welcome after the session and remote stream exist and playback has been attempted, allowing an immediate autoplay rejection to surface first. A new regression test holds playback pending until the welcome is requested. Requesting speech is not itself proof that the user heard it. First-time visitors still need to grant browser microphone permission; blocked playback exposes Enable audio, mutes capture and closes an unattended blocked session after 15 seconds. Physical microphone/speaker hardware and every browser's policy remain separate checks.
