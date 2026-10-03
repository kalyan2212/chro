# Workforce Intelligence Studio

The Studio is a conversational presentation of the existing synthetic CHRO workspace. It turns validated answers into a focused scene: the finding, calculated figures, an appropriate chart, the interpretation, and useful next questions. The underlying metric definitions, scenario engine, source revisions and saved workspace remain authoritative.

All workforce figures describe fictional Meridian Group. This is not a connection to an employer's personnel records, an approval system or a guarantee that any possible spoken question can be answered.

## Start with a conversation

Open the application normally to enter Studio. **Workspace ↗** opens the full Monitor → Investigate → Decide interface; **← Intelligence Studio** returns to Studio. The direct `/?workspace=1` address starts in the detailed workspace. Both interfaces use the same server, source snapshot and saved records.

The opening cards come from the server's governed overview. **Explore** searches the definitions of 50 available metrics and the six scenario labs. A catalog entry makes the metric discoverable; it does not remove a missing-definition gate, a privacy threshold or a limitation on available comparisons.

Try this sequence:

1. **“Where should I focus today?”** opens the scoped briefing.
2. **“What could explain first-year exits?”** opens an onboarding/cohort investigation. The rate comparison is explicitly an association, not proof of cause.
3. **“Compare Engineering and Sales.”** carries the metric into a comparison. **“Show that by region.”** changes the comparison dimension.
4. **“Model retention with a half-point reduction.”** opens the retention scenario. At the shipped $240,000 program cost and $25,000 replacement-value assumption, 0.5 percentage points models six avoided exits, $150,000 gross value and **−$90,000 net value**.
5. Change the program budget in **Adjust the assumptions**, select **Recalculate**, then ask **“Keep the budget but make it one percentage point.”** The subsequent turn preserves the stated budget.
6. Use **Save investigation** or **Save decision** to retain the work. Open **Library** after reloading to inspect the saved evidence and original source revision.

The scenario population is fixed by its lab. A selected function or region supplies descriptive context; it does not silently change the retention lab's next 1,200 hires. Positive and negative financial bars share a zero baseline. Program cost is presented as an outflow. Charts for the other labs use compatible units within each scene, such as ready FTE, covered services, accepted weekly units or the queue through 12 months.

## Context and coverage

The server validates the active metric, scenario, bounded assumptions, insight and source revision before calculating a follow-up. Short references such as “that,” scenario corrections and the Sales alias have explicit supported handling. An ambiguous “0.5 percent” requests a clarification between percentage points and a relative percentage reduction. The distinction changes the arithmetic.

The browser keeps a bounded scene history in the current tab. Back navigation restores prior assumptions without requesting another analysis. This conversation history is not the persistent investigation notebook: reloading starts a new conversation, while saved investigations and decision drafts remain in the Library.

Supported analytical paths include metric explanations, function/region/month comparisons and trends, cost variance and onboarding insights, and all six existing scenario labs. Explicit supported multi-step questions can expose their analytical steps alongside the final scene. Supported natural-language handling and the structured routing model are bounded by the same calculation engine. No document retrieval index or external policy corpus has been added, and this release does not claim 100% natural-language coverage or parity with a launch demonstration.

## Saving and evidence lineage

Studio uses the existing authenticated investigation and decision endpoints. The server rebuilds metric observations and scenario calculations instead of trusting browser-supplied numerical results. Saves produce immutable records; an identical save is deduplicated. Changed work produces a new saved record. Decisions remain **draft-unapproved**: saving does not approve, fund or execute an intervention.

An investigation preserves its question, notes, scoped observation, pinned references and source revision. A decision preserves the effective assumptions, calculated result, rationale, owner, stop condition and evidence references. The detailed workspace retains the additional decision-record, review and export tools. Studio's **Export brief** downloads a text briefing with facts, definitions and revision; it is not a server save or an approved board paper.

The Library displays the original saved observation and revision. **Reopen against current evidence** requests a current calculation while retaining the selected saved assumptions where applicable; it does not overwrite the old record. Stale source or conversation revisions, and stale pinned references, are rejected with HTTP 409. Refresh and re-establish the current evidence before saving new work. Local `.state` and private cloud storage retain their existing roles; Studio does not migrate or replace them.

For persistence details and limits, see [Investigations](INVESTIGATIONS.md), [the integration contract](../CONTRACT.md) and [GCP deployment](DEPLOYMENT-GCP.md).

## Voice and visual emphasis

The Studio home attempts one continuous-voice connection after its opening evidence and voice availability load. It first checks workspace sign-in, then requests microphone permission. Automatic startup only runs on the visible home; the detailed workspace and `/?voice=manual` remain manual. **Talk to your data** starts or retries a conversation, and **Stop** ends it. A denied permission or unavailable connection does not trigger repeated automatic attempts. Stop, navigation and context changes cancel a pending automatic start.

The app requests a brief welcome after the Live session and remote audio stream are established and playback has been attempted. It does not wait for the first incoming speech before requesting that speech. A requested welcome does not confirm that the browser played it; playback readiness is tracked separately. The welcome introduces the synthetic workspace; it does not run an analyst lookup. It is sent once per session and skipped if the caller has already begun speaking. Browsers may require a click before audible playback even after microphone permission is granted. If playback is blocked, Studio shows **Enable audio**, mutes the microphone locally, and keeps **Stop** available. It closes the session if playback is not enabled within 15 seconds. Browser restrictions cannot be bypassed by this app; see the [browser autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).

Switching to another tab releases the microphone and requests session closure; returning does not reconnect automatically. Select **Talk to your data** to resume. Connected duration can incur voice usage even while muted, and sessions retain the 15-minute limit. Local release or a server close request does not confirm final billed usage; only the provider's finalization event supplies that result.

**Listen** plays the current answer as a turn-based briefing. The screen shows facts already calculated by the backend; assistant speech is not displayed as a transcript. Internal transcript events support question recovery and approximate evidence highlighting. Studio highlights the relevant fact and chart when a matching transcript label is available, or follows approximate playback progress for turn-based narration. It does not claim word-level synchronization. An interruption or stop clears the active emphasis.

Continuous voice now receives several bounded, verified explanation updates instead of relying on one short summary for the entire answer. Updates are submitted sequentially. A matching provider acknowledgement permits the next update: it confirms that explanatory context was accepted, **not** that the caller heard the audio. A timeout leaves the visual result available and reports that the remaining explanation was not acknowledged. Scope changes, new speech and stop invalidate queued narration. Final usage is confirmed only by the upstream finalization event, not by an acknowledgement or a local Stop click.

The deployed server needs configured API access. A remote caller needs HTTPS, a current workspace sign-in, browser microphone permission and working playback. No caller-side API key is required. Authentication expiry, denied capture and playback errors retain recovery controls; see [Voice troubleshooting](VOICE-TROUBLESHOOTING.md).

## Reproducible checks and limits

```sh
npm test
node scripts/check-studio.mjs
node scripts/check-studio-voice.mjs
npm run test:browser
node scripts/check-voice-guide.mjs
node scripts/check-shared-link.mjs
```

Browser scripts use Chromium through `playwright-core`; set `CHRO_BROWSER` when Chrome is installed at a different path. They use isolated synthetic state. The Studio review exercises navigation, questions, editable assumptions, persistence, evidence lineage, responsive layouts, reduced motion and chart rendering. The voice browser review simulates microphone and WebRTC transport while exercising the real local question engine and UI. It checks authentication failure before capture, denied permission, acknowledgement ordering, interruption, scope cancellation and cleanup.

Screenshots and machine-readable review output are under [studio](studio/) and [studio-voice](studio-voice/). The existing workspace regression checks continue to run against `/?workspace=1`; their assertions remain in place. GitHub Actions runs the application tests, legacy browser checks and both Studio checks before deployment.

Automated transport tests and visual inspection do not establish physical microphone quality, audible speaker output, actual provider latency, speech fidelity or a complete live conversation. Provider and target-device results must be reported separately from these checks.

## Real-provider result — October 1, 2026

An isolated local build was exercised against the configured real provider using generated microphone input through WebRTC. The recognized retention question opened the correct scene. The completed spoken result included six avoided exits, $150,000 gross value and minus $90,000 net. Both narration updates were acknowledged, measurable audio arrived, and the provider reported a final24.0-second session on clean close. [Sanitized report](studio-voice/provider-report.json) and [captured scene](studio-voice/provider-retention.png). This checks one scenario and the protocol; physical microphone/speaker behavior and the Cloud Run media path are separate verification boundaries.
