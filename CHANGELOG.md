# Changelog

All notable changes to this project are documented here, derived from the
project's merged pull request and release-tag history.

## v0.1.2 — 2026-06-30

- ci: add truthful-attribution-gate in WARN (advisory) mode (#8)
- ci: adopt the reusable extension->host IoC conformance gate (org-wide rollout) (#9)
- ci: tag-driven GitHub release on v* (#10)
- ci: adopt secret-scan-gate (#11)
- docs(readme): expand README to the org standard (#12) (#13)
- ci(ui-gate): ramp raw-JSX block warn->error (0 warnings clean) (#14)
- ci(ui-gate): re-vendor preset with Block-C (dynamic-import ban) + bump pin to v0.1.1 (#15)
- chore: strip private engineering-tracker refs from public source (#17)
- feat(setup): link 'LinkedIn developer app' to the developer portal (#16) (#20)
- chore: strip private tracker references from workflow comments (#21)
- ci(release): re-pin release.yml to the release-approval wall (.github@v0.1.1) (#23)

## v0.1.1 — 2026-06-13

- Configure Renovate (#1)
- Do not redirect from the save action (avoids NEXT_REDIRECT swallow) (#2)
- ci(release): grant contents: write + pin reusable workflow to .github HEAD (#4)
- ci: repin reusable release workflow (immutable-safe decoration + corrected build-input provisioning) (#5)
- release: bump linkedin-oauth-connector 0.1.0 -> 0.1.1 + repin release workflow (#6)
- release: exclude src/__tests__ from publish tarball (packlist gate #56) (#7)

## Unreleased

- fix(setup): remove the extension-rendered connection-status pill (#24)
- fix: refresh setup page after saving so stored credentials render (#25)
- chore(manifest): backfill cinatra.sdkAbiRange ^2 (#26)
- fix: echo the canonical Nango OAuth redirect URI on the LinkedIn setup page (#28)
- fix(manifest): grant the nango host port (required by the redirect-URI echo) (#29)
- chore(deps): declare cinatra.consumes for closure-gate enrollment (#30)
- chore(deps): align zod pin to ^4.4.3 (#31)

