# EquiVerdict local source-of-truth audit

## Scope and deployment

The current source is `contracts/dispute_resolver.py`. Deployment of this corrected source is pending redeployment / provenance verification. No address is canonical yet. No deployment, commit or push was performed during this preparation.

## Address inventory

| Address | Classification | References found before alignment |
| --- | --- | --- |
| `0x6dD436Fe2Cb40486f7D60Ca02161B05f90B319ce` | Unknown deployment provenance; formerly current frontend configuration, not verified corrected source | `app/lib/genlayer.ts`, working `README.md`, captured terminal-output artifact in repository root |
| `0x1e3F5ffAa55c891b30b2b920eEE65E5e154b5aFe` | Stale historical candidate | `.reviewer-fix-backup-20260829-144147/app/lib/genlayer.ts`, `equiverdict_fix_context.txt`, historical README/explorer lines inside the root terminal-output artifact |

The terminal-output artifact has a filename beginning with the private-use glyph followed by `Select-String -Pattern`; it is captured output, not executable application source. Backups and captured notes are historical, not configuration. Their contents are preserved. Addresses of unrelated ClaimGuard, GrantProof and MilestoneGuard projects are outside EquiVerdict scope; generated dependencies/build caches are not source-of-truth deployments. No corrected current deployment address was identified.

`app/lib/genlayer.ts` now reads `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS`. No default is provided. Missing, malformed and zero addresses are rejected before RPC writes; missing configuration does not prevent a local production build. `.env.local` existed but contained no public contract-address setting. No real environment secret or deployment setting was changed.

## ABI inventory

All EquiVerdict contract invocations are in `app/lib/genlayer.ts`.

| Method | Ordered parameters | Kind |
| --- | --- | --- |
| `create_dispute` | `case_id, freelancer_wallet, agreement, disputed_amount` | write |
| `accept_agreement` | `case_id, agreement_sha256` | write |
| `submit_evidence` | `case_id, evidence_type, title, description, importance, timestamp, evidence_uri, evidence_sha256, accepted_agreement_sha256` | write |
| `freeze_evidence` | `case_id` | write |
| `evaluate_dispute` | `case_id` | write |
| `get_dispute` | `case_id` | view |
| `list_disputes` | none | view |

There is no `get_case`, `submit_dispute`, separate evidence read, or separate verdict read in this contract. Evidence and verdicts come from case reads. Case mapping preserves contract-assigned evidence IDs and ordered provenance. `content_sha256` in the UI labels the ABI field `evidence_sha256`; there is no invented content-hash ABI parameter.

The canonical agreement is versioned `equiverdict-agreement-v1`, with explicit ordered JSON keys, trimmed text and lowercase wallet addresses. `version` and `terms` live inside the `agreement` string; they are not new ABI parameters. Browser SHA-256 hashes the same UTF-8 bytes sent in creation. The server-returned hash is used for acceptance and evidence submission.

## GenVM linter discovery

No EquiVerdict requirements file, pyproject, lockfile, package script, CI definition or project documentation declares a required GenVM linter version. Tracked dependency history includes the npm lockfile, not a Python linter pin.

An existing local installation was found at `.venv312/Lib/site-packages/genvm_linter-0.11.0.dist-info/METADATA`: `genvm-linter==0.11.0`. Its executable is `.venv312/Scripts/genvm-lint.exe`. This is an identifiable installed version, not a project-declared requirement. No arbitrary version was installed. The direct-test SDK value `v0.2.12` is an SDK version, not a linter version.


The installed linter is `genvm-linter==0.11.0`. Its E010 reachability warning was resolved by placing both leader-side and validator-side HTTPS fetch, byte hashing and fail-closed verification directly in the `run_nondet_unsafe` callbacks. `genvm-lint check` now passes. I200 notes a newer runner; the pinned contract runner was preserved.

Frontend lint is not configured: `package.json` has no lint script or lint dependency/configuration. `npm run lint` reports a missing script; this is not a passing lint result.
