# Release validation — version 2.0.1

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
