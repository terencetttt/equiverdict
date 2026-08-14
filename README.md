# EquiVerdict

**Evidence-led freelance dispute resolution on GenLayer.**

EquiVerdict is a decentralized application for structured freelance dispute resolution. Clients and freelancers submit the dispute terms and supporting evidence, and a GenLayer Intelligent Contract evaluates both sides through nondeterministic execution and validator consensus before producing a transparent, on-chain outcome.

## Live Demo

- **App:** https://equiverdict.vercel.app
- **Network:** GenLayer Bradbury Testnet
- **Intelligent Contract:** `0x1e3F5ffAa55c891b30b2b920eEE65E5e154b5aFe`
- **Explorer:** https://explorer-bradbury.genlayer.com/address/0x1e3F5ffAa55c891b30b2b920eEE65E5e154b5aFe

## Why EquiVerdict

Freelance disputes often depend on fragmented evidence: contracts, milestone records, delivery notes, conversations, invoices, screenshots, and scope changes.

Without a consistent review process, disagreements about quality, deadlines, scope, and payment can become subjective and difficult to audit.

EquiVerdict turns that evidence into a structured GenLayer dispute workflow where both parties are represented before the contract produces a consensus-backed recommendation.

## How It Works

1. **Create a dispute**
   - Enter the case title, category, disputed amount, client, freelancer, and case summary.

2. **Submit evidence from both parties**
   - Evidence records are explicitly tagged as **Client** or **Freelancer**.
   - Multiple evidence records can be submitted.
   - Each record can include evidence type, importance, summary, and an optional reference URL.

3. **Submit the dispute on GenLayer**
   - The frontend sends the dispute and both evidence arrays to the deployed Intelligent Contract.

4. **Nondeterministic evaluation**
   - The contract evaluates the agreement context and evidence using GenLayer nondeterministic execution.

5. **Validator consensus**
   - Validators independently evaluate the dispute and compare constrained outputs such as verdict category, next action, confidence, and payment allocation within allowed tolerances.

6. **Persist the outcome**
   - When consensus succeeds, the case is stored and can be read back by the application.

7. **Handle unresolved consensus safely**
   - If the transaction is `UNDETERMINED`, the app does not create a false case result.
   - The user is shown a clear retry message and can provide stronger agreement terms or evidence.

## Consensus Output

A successful dispute can return:

- **Verdict**
- **Confidence score**
- **Payment recommendation / split**
- **Reasoning**
- **Recommended next action**

The narrative explanation is preserved for transparency, while consensus is based on constrained fields rather than brittle word-for-word text matching.

## Screenshots

### Create a dispute

Users define the dispute, participants, category, disputed amount, and agreement context before submitting evidence.

![Create dispute](docs/screenshots/consensus-create-dispute.png)

### Submit evidence from both parties

EquiVerdict supports structured evidence from both the Client and Freelancer.

![Submit evidence](docs/screenshots/consensus-submit-evidence.png)

### Consensus-backed verdict

The live workflow evaluates evidence from both parties and presents the resulting verdict, confidence, reasoning, and evidence trail.

![Consensus-backed verdict](docs/screenshots/consensus-both-sides.png)

## Tested Behaviors

The current deployment has been tested with multiple realistic disputes, including:

- **Deadline dispute:** both parties contributed to the delay; the contract returned a shared-responsibility outcome.
- **Payment / scope dispute:** the freelancer completed the agreed scope while the client requested extra features afterward; consensus favored payment for completed scope.
- **Quality / defect dispute:** the work was delivered with verifiable defects; consensus produced a split-payment recommendation.
- **Ambiguous dispute:** validators could not reach consensus; the frontend correctly handled `UNDETERMINED` without navigating to a nonexistent case.

These tests demonstrate both successful consensus-backed decisions and safe handling of unresolved consensus.

## Intelligent Contract

Primary contract:

```text
contracts/dispute_resolver.py
