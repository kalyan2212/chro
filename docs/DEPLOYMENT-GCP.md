# Google Cloud deployment

This workspace runs as a Node 24 container on Cloud Run in `us-central1`, project `project-ed47fc09-912f-41b0-92f`.

- Browser uses HTTPS to reach the UI and API on the same service.
- Cloud Run uses its runtime identity to read/write two private, versioned Cloud Storage objects: the synthetic source snapshot and the investigation/decision journal. Generation preconditions prevent silent concurrent overwrites. Failed storage calls fail visibly.
- Secret Manager injects the shared workspace password and configured OpenAI key. Provider requests originate from the backend; browser voice additionally uses WebRTC. Optional Claude review requires its own key and model.
- GitHub Actions tests pushes and pull requests. Successful `main` builds deploy a container tagged with the commit SHA. Deployment uses OIDC Workload Identity Federation restricted to this repository ID, owner ID and main branch. No service-account key is required.

The app remains a synthetic demonstration, with shared-password access and no Workday or enterprise SSO connection. The saved local `.state` was seeded privately into Cloud Storage once. Subsequent local edits and cloud edits are independent; deployments do not replace cloud state.

## Resources

- Repository: https://github.com/kalyan2212/chro
- Workflow: `.github/workflows/deploy-gcp.yml`
- App: https://chro-127316151094.us-central1.run.app
- State bucket: `project-ed47fc09-912f-41b0-92f-chro-state`, prefix `chro/`
- Artifact Registry repository: `us-central1/chro`
- Runtime identity: `chro-runtime@project-ed47fc09-912f-41b0-92f.iam.gserviceaccount.com`
- Deployment identity: `chro-deploy@project-ed47fc09-912f-41b0-92f.iam.gserviceaccount.com`
- Workload identity provider: `projects/127316151094/locations/global/workloadIdentityPools/chro-github/providers/github`

The workspace password is the existing local APP_PASSWORD when configured, otherwise a generated password saved only to ignored `.cloud-local/workspace-password.txt`. It can also be retrieved by an authorized project owner from Secret Manager secret `chro-app-password`. Never put it in GitHub or documentation.

## Deployment and operation

Push to `main` or run the workflow manually from Actions. Tests and browser review precede deployment. The workflow's final smoke check verifies the public sign-in page; it does not claim provider entitlement or microphone operation.

Cloud Run currently keeps one instance warm with CPU allocated and session affinity, capped at one instance under normal operation. This incurs ongoing compute charges even while idle. Authentication and live voice sessions are in memory: a restart or deployment requires sign-in again and can interrupt voice. Saved evidence, investigations and decisions remain in Cloud Storage. Revisions may briefly overlap; state writes use generation checks. This is not a horizontally scaled multi-user SaaS design.

For rollback, use Cloud Run's Revisions tab to direct traffic to the previous successful revision. Object versioning allows an administrator to recover saved state separately. Cloud Storage versions and container images accumulate until a retention policy is configured. Avoid deleting or replacing objects while users are saving.

`STATE_BUCKET` enables Cloud Storage; `STATE_PREFIX` defaults to `chro`. Without them, existing local `.state` behavior is unchanged. Container COPY rules include only runtime modules and `public/`; `.env`, `.state`, local credentials, tests and screenshots are excluded from the image.

## Verification

Local automated suite: 88 passing tests, including cloud concurrency, restart persistence, generation preconditions and write-failure behavior. Private GCS writes and reads were exercised using the actual bucket. See `CONTINUATION-REVIEW.md`, `REDESIGN.md` and the browser screenshots for presentation review. Cloud deployment verification is recorded after the workflow runs.

First deployment succeeded through [GitHub Actions run 36471158707](https://github.com/kalyan2212/chro/actions/runs/36471158707), commit `0438b52`, revision `chro-00001-79p`. Live Chrome verification at 1920×1080 confirmed Monitor, Investigate and Decide, secure HttpOnly sign-in cookies, unauthenticated API rejection (401), cloud persistence, save/reload with pinned evidence, mobile navigation and no browser JavaScript errors. Screenshots and machine-readable results are in `docs/cloud/`. No upstream model call was made, so model entitlement and real microphone/speaker behavior remain unverified. The six offline preflight checks also passed.

A second successful workflow run [36471660860](https://github.com/kalyan2212/chro/actions/runs/36471660860) deployed commit `7d47fe9`. A fresh revision `chro-verify-7d47fe9` of that image was then created explicitly for persistence verification. Authenticated reads confirmed the saved investigation, the saved decision (including its -$90,000 downside calculation and pinned evidence), and the synthetic source snapshot matched their pre-revision contents exactly. Authentication sessions are recreated after the restart; saved state is external to the instance. No deployment blocker remains. Provider entitlement and physical microphone/speaker checks remain outstanding.

Shared-link fix: allow cross-site top-level GET navigation to the workspace entry page. Cross-site API calls, login posts, frames and invalid origins remain rejected. The 89-test suite passes; a real Chrome link from a separate origin reaches the sign-in page. GitHub Actions now includes this browser regression check.

## Narration attention guide

Continuous voice now prepares a persistent evidence guide from the validated answer, spotlights the relevant dashboard section, and highlights fact labels recognized in output transcript fragments. Interruption, Stop, source refresh and manual navigation clear the guide and pending spotlight. It does not infer numbers from speech. Recorded narration uses explicitly approximate playback progress; browser speech uses boundary callbacks. Users can select a fact or hide the guide. Reduced-motion preferences disable decorative animation.

Verified with 100 application tests and `node scripts/check-voice-guide.mjs`: desktop/mobile layout, validated facts, transcript matching, cancellation before delayed focus, reduced motion and dismissal. Screenshots are in `docs/narration/`. This browser test simulates transcript delivery; it is not a real microphone-to-provider conversation or proof of precise audio synchronization.

The existing backend has a structured metric catalogue, scenario calculations, breakdowns and selected insights. Live commentary is deliberately bounded to 450 bytes, so spoken summaries do not contain all available evidence. A future coverage expansion should enumerate every supported view, definition and action with representative question tests; keep calculations in the engine and add document retrieval only for prose sources. A workflow graph can coordinate multi-step investigations, but neither a graph nor RAG establishes 100% semantic question coverage.
