# Freelance Dispute Resolver Implementation Plan

## Overview
This document is the implementation blueprint for the Freelance Dispute Resolver MVP, a GenLayer-powered dispute resolution experience called **FairWork Verdict**. The MVP is intentionally small, reliable, and visually impressive.

The app uses a GenLayer Intelligent Contract to interpret dispute evidence and return a transparent, explainable verdict.

---

## 1. Project folder structure

Recommended structure for one developer:

- `/` 
  - `README.md`
  - `PROJECT_PLAN.md`
  - `COMPETITION_RULES.md`
  - `AGENTS.md`
  - `IMPLEMENTATION_PLAN.md`
- `/app` or `/src`
  - `pages/` or `routes/`
    - `index.tsx` / `page.tsx` (landing)
    - `dispute/new.tsx` / `page.tsx`
    - `dispute/[id].tsx` / `page.tsx`
    - `dashboard.tsx`
    - `about.tsx`
  - `components/`
    - `Header.tsx`
    - `CaseCard.tsx`
    - `EvidenceSummary.tsx`
    - `VerdictPanel.tsx`
    - `StatusBadge.tsx`
    - `SubmitEvidenceForm.tsx`
  - `styles/`
    - `globals.css`
    - `components.css`
- `/lib`
  - `genlayer.ts` or `genlayerClient.ts`
  - `api.ts`
  - `types.ts`
  - `rubric.ts`
- `/contracts`
  - `dispute_resolver.py`
  - `schemas.py`
  - `tests/`
    - `contract_spec.py`
    - `case_examples.py`
- `/pages/api` or `/app/api`
  - `submit-dispute.ts`
  - `get-dispute/[id].ts`
  - `list-disputes.ts`
- `/data` or `/fixtures`
  - `sample_cases.json`
  - `validation_rules.md`
- `/tests`
  - `frontend.test.ts`
  - `contract.test.ts`

Notes:
- Keep the frontend, API, and contract code separated.
- Use a single `contracts/` directory for the GenLayer Intelligent Contract implementation and contract-specific tests.
- If using Next.js, keep UI pages under `pages/` or `app/` and API routes under `pages/api/`.

---

## 2. Intelligent Contract design

Design the Intelligent Contract as a small, rule-guided adjudicator with a structured input and a fixed output schema.

Key elements:
- Contract name: `FreelanceDisputeResolver`
- Deployment target: GenLayer Intelligent Contract runtime (Python)
- Input: a single dispute payload containing case metadata, evidence summary, and dispute category.
- Output: a structured verdict object with a category, decision, explanation, confidence, and recommended next step.
- Logic style: deterministic rubric + evidence weighting, not unconstrained generative output.

Primary contract responsibilities:
- Validate required fields and evidence formats.
- Map evidence to rubric items.
- Score each side against the dispute category.
- Produce a final decision with an explanation tied directly to the rubric.
- Return a stable schema that the UI can render consistently.

---

## 3. Contract state and methods

### State model
The contract state should be minimal and case-centric.

State fields:
- `cases`: list of case records or a case index keyed by `case_id`
- `case_status`: status values such as `submitted`, `evaluated`, `needs_review`
- `last_updated`: timestamp for auditability
- `verdict_schema_version`: version identifier for the contract output format

Optional state fields for MVP:
- `settings`: static rubric configuration
- `approved_categories`: list of allowed dispute types
- `validation_rules`: evidence quality thresholds

### Methods
The contract should expose these methods:

1. `submit_dispute(case_payload)`
   - Accepts the dispute payload.
   - Normalizes and validates input.
   - Stores the case in contract state.
   - Triggers evaluation.

2. `evaluate_dispute(case_id)`
   - Runs the rubric and evidence scoring logic.
   - Returns a verdict object.
   - Updates `cases[case_id].verdict` and `cases[case_id].status`.

3. `get_dispute(case_id)`
   - Returns stored case details and verdict.

4. `list_disputes(filter)`
   - Returns a summary of submitted disputes.

5. `update_case_metadata(case_id, metadata)` (optional)
   - Allows case edits before finalization.
   - For MVP, keep this method read-only or disabled.

6. `get_rubric()`
   - Returns the current rubric description for transparency.
   - Useful for UI explanation and validation.

### Output schema
Return a consistent object shape such as:
- `verdict_category`: `favor_freelancer` | `favor_client` | `partial` | `insufficient_evidence`
- `decision_label`: short text such as `Release payment` or `Refund partially`
- `confidence_score`: number or level
- `explanation`: structured list of rationale points
- `recommended_next_step`: `accept`, `review_manually`, or `gather_more_evidence`

---

## 4. How evidence will be submitted

Evidence should be submitted as structured items and optional references, not as raw long text only.

Evidence model:
- `evidence_items`: array of objects with:
  - `type`: `milestone`, `chat`, `delivery_note`, `invoice`, `screenshot_link`, `file_link`
  - `title`: short label
  - `summary`: concise description
  - `role`: `client` or `freelancer`
  - `timestamp`: optional date
  - `content`: optional text excerpt or note
  - `url`: optional hosted link to external evidence
  - `importance`: optional user-selected relevance level

Submission flow:
1. User creates the dispute.
2. They choose dispute category and add a case summary.
3. They add evidence items one by one.
4. The UI collects evidence into a JSON payload.
5. The payload is sent to the GenLayer contract via the API.

Evidence handling rules:
- Require at least one evidence item.
- Prefer 3–5 evidence items for a strong case.
- Allow users to provide external links and note why each item matters.
- Keep uploads optional and simple for MVP.

Evidence preview:
- Show a summary card for each item.
- Let users reorder or remove items before submission.
- Display an evidence strength indicator.

---

## 5. How GenLayer validators will evaluate evidence

In GenLayer, the intelligent contract acts as the adjudicator and validators execute the contract logic.

Validator evaluation process:
- Validators receive the dispute payload and contract state.
- They run the contract method `evaluate_dispute(case_id)` or its equivalent.
- The contract applies the rubric and computes the same structured verdict.
- The validator verifies that the contract output matches expected state transitions and schema.

Key validation responsibilities:
- Confirm required fields are present.
- Ensure evidence is mapped to supported types.
- Check that the verdict output is within the allowed categories.
- Confirm the explanation is not empty when a decision is produced.

Design notes:
- Keep each evaluation deterministic.
- Avoid unconstrained natural language where validators might disagree.
- Use explicit scores or rule flags instead of free-form reasoning only.

Example rubric evaluation:
- `milestone_delivered` present? +1 for freelancer.
- `client_requested_revision` present? -1 for freelancer if not delivered.
- `agreement_mismatch` present? +1 for client.
- Add evidence strength weighting based on `importance` or category.
- Aggregate to a final verdict threshold.

---

## 6. How the final decision will be produced

The final decision is produced by the contract executing the rubric after evidence submission.

Decision flow:
1. `submit_dispute()` stores the case and normalizes evidence.
2. `evaluate_dispute()` runs the rubric, computing reasoned scores.
3. The contract chooses one of the final categories.
4. It builds an explanation object with 3–5 bullet points.
5. It sets a confidence score and a next-step recommendation.
6. The verdict is stored and returned to the frontend.

Final decision components:
- `verdict_category`
- `decision_label`
- `confidence_score`
- `explanation_points`
- `recommended_next_step`

Decision examples:
- `favor_freelancer`: “Freelancer delivered core milestones, client requested changes after completion.”
- `favor_client`: “Delivered work does not match agreed scope, evidence is incomplete.”
- `partial`: “Some work delivered, but key milestone remains incomplete.”
- `insufficient_evidence`: “The case needs clearer delivery proof or agreement terms.”

Manual review option:
- If confidence is low or evidence is contradictory, return `needs_review`.
- This allows the app to surface “flag for manual review” instead of forcing a binary decision.

---

## 7. Frontend pages and components

### Pages
1. `Landing` / `/`
   - Hero section and value proposition.
   - CTA to start a dispute.
   - Short explanation of GenLayer adjudication.

2. `Create Dispute` / `/dispute/new`
   - Case summary input.
   - Dispute category selector.
   - Contract terms / expected deliverables fields.
   - Evidence item builder.
   - Submit button.

3. `Dashboard` / `/dashboard`
   - List of disputes.
   - Status badges: `Draft`, `Submitted`, `Evaluated`, `Needs review`.
   - Quick verdict preview.

4. `Case Detail` / `/dispute/[id]`
   - Full dispute summary.
   - Evidence list.
   - Verdict panel with explanation.
   - Confident next-step card.

5. `About / How it works` / `/about`
   - Chart of the dispute flow.
   - Why GenLayer is used.
   - Example verdict categories.

### Core components
- `Header`
- `Footer`
- `CaseCard`
- `EvidenceSummary`
- `EvidenceItemForm`
- `VerdictPanel`
- `StatusBadge`
- `ProgressStepper`
- `ConfirmationModal`

### Visual priorities
- Use a polished neutral palette with accent color for decisions.
- Highlight evidence and verdict side-by-side.
- Keep the UI clean and readable.
- Show confidence as a progress bar or ring.
- Use cards for evidence and verdict items.

---

## 8. Wallet and transaction flow

MVP wallet flow should be minimal and optional. Focus on a modern UI with GenLayer contract calls.

Wallet integration options:
- `Connect Wallet` using MetaMask / WalletConnect for optional authentication.
- Or a wallet-agnostic session login if wallet integration is too heavy.

Transaction flow:
1. User chooses to connect wallet.
2. App requests a signature for identity or case submission.
3. User submits dispute.
4. The app calls the backend / GenLayer client.
5. The backend signs / submits the transaction to GenLayer.
6. The contract executes and returns the verdict.

Recommended MVP approach:
- Do not require wallet for the first version.
- Use wallet connection only for a polished “submit with wallet” path.
- Keep contract invocation abstracted behind an API route.

If wallet is included:
- Use the wallet transaction to anchor the case submission.
- Keep the GenLayer transaction payload small.
- Display transaction status: `Pending`, `Confirmed`, `Evaluated`.

---

## 9. Testing strategy

Testing should cover the contract, API, and frontend flows.

### Contract tests
- Unit tests for `submit_dispute()` validation.
- Unit tests for `evaluate_dispute()` verdict outcomes.
- Case examples for each verdict category.
- Schema tests for output shape.

### API tests
- Submit example dispute payloads.
- Validate response structure.
- Verify `get_dispute()` returns stored verdict.
- Test error handling for missing evidence or invalid category.

### Frontend tests
- Snapshot or component tests for `VerdictPanel`, `EvidenceSummary`, and `Create Dispute` flow.
- Integration test for page navigation: landing → new dispute → dashboard → case detail.
- If using Jest / React Testing Library, assert that verdict text renders.

### End-to-end / manual test scenarios
- Freelancer case where work is delivered and client requests more revision.
- Client case where milestone scope is missing.
- Partial outcome and insufficient evidence scenario.

### Quality checks
- Ensure output is deterministic across repeated evaluations.
- Verify the same payload always produces the same verdict.
- Confirm UI displays verdict, explanation, and confidence consistently.

---

## 10. Exact build order for one developer

1. Create the folder structure and initialize the repo.
2. Define the dispute data model and Evidence schema.
3. Draft the contract API surface and verdict schema.
4. Build the minimal frontend skeleton and page routes.
5. Implement the GenLayer contract stub in `contracts/dispute_resolver.py`.
6. Wire frontend submission to the backend API route.
7. Implement contract evaluation logic and verdict output.
8. Add `Case Detail` page rendering evidence and verdict.
9. Implement a simple dashboard list and case retrieval.
10. Add contract tests and API tests.
11. Polish UI appearance and decision presentation.
12. Add optional wallet connect path if time remains.
13. Run a full demo case and verify the end-to-end flow.

Note: keep the first working version as `submit -> evaluate -> show verdict` before adding extras.

---

## Appendix: MVP constraints and success criteria

Keep the MVP small by limiting scope to:
- one dispute submission flow
- a small set of evidence types
- one GenLayer Intelligent Contract
- a single case detail view
- deterministic verdict output

Success criteria:
- A dispute can be created and evaluated.
- The verdict is explainable and visually clear.
- The workflow is polished enough for a demo.
- The contract uses GenLayer logic rather than only static rules.

This plan is intentionally focused on reliability, clarity, and demo readiness.
