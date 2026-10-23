# Repository Maintenance

Housekeeping decisions that are planned but not yet carried out. Each one says what to do and what to check.

## Research notes

The background research lives in `docs/research/`: the original Persian requirements study
(`deep-research-report.md`), its decision layer (`deep-research-report-2.md`) and the four primary-source reports it
cites (`offline-sync.md`, `auth-security.md`, `iran-platform-rails.md`, `buy-vs-build.md`). They are dated research
from before the build, not a description of the current system: for that, read the ADRs in `docs/adr/` and
`docs/pilot/MASTER-PILOT-READINESS.md`.

## Evidence screenshots (plan, not done)

Milestone and review documents embed screenshots committed next to them: about 360 PNG/WebP files, roughly 38 MB
(about 30 MB of it PNG), mostly in `docs/product/page-studio-evidence` (9 MB), `docs/design/**` (phase evidence,
redesign before/after), `docs/architecture/portal-redesign/**`, `docs/release/evidence` and
`docs/deployment/staging-evidence`. Every clone downloads all of them and every refreshed screenshot adds its full
size to the history again.

Nothing has been moved or deleted. When this is taken on, pick one of these options:

1. **Git LFS for new screenshots (preferred while the documents still change).** Add
   `docs/**/*.png filter=lfs diff=lfs merge=lfs -text` (and `*.webp`, `*.jpg`) to `.gitattributes`, then run
   `git lfs install` and `git add --renormalize docs`. Existing history keeps its copies, so the clone size only
   drops after `git lfs migrate import --include="docs/**/*.png,docs/**/*.webp,docs/**/*.jpg" --everything`. That
   rewrites history and needs agreement from everyone with a clone, and every open branch rebased afterwards. Check
   first that the hosting plan's LFS storage and bandwidth quota covers it, and that CI checkouts that don't need the
   images skip LFS (`actions/checkout` with `lfs: false`, the default).
2. **Release assets for frozen evidence.** Evidence of finished milestones (`docs/design/phase*-evidence`,
   `docs/architecture/portal-redesign/**`, `docs/release/evidence`) no longer changes. Zip each folder, attach it
   to a GitHub release (for example `evidence-2026-10`), replace the images in the documents with a link to the
   asset, and delete the folders in a normal commit. History keeps the old copies unless it is also rewritten.

Either way: keep `web/public/**` (the app's real icons and brand files) out of it, coordinate
`docs/deployment/staging-evidence` with whoever owns the deployment documents, and afterwards check that no
Markdown file still points at a moved image (`git grep -n "evidence/.*\.png"`).
