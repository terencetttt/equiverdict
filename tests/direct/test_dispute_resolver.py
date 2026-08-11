import json
import os
from pathlib import Path

import pytest

SDK_VERSION = "v0.2.12"


@pytest.fixture(autouse=True)
def tolerate_gltest_windows_stdin_cleanup(monkeypatch):
    """Work around gltest 0.29.2 unlinking an fd still held by Windows stdin."""
    real_unlink = os.unlink

    def unlink(path, *args, **kwargs):
        try:
            return real_unlink(path, *args, **kwargs)
        except PermissionError:
            return None

    monkeypatch.setattr(os, "unlink", unlink)


def evidence(role: str, summary: str, evidence_type: str = "chat") -> dict:
    return {
        "type": evidence_type,
        "role": role,
        "title": role.title() + " evidence",
        "summary": summary,
        "importance": "high",
        "timestamp": "2026-08-11",
        "url": "https://example.com/" + role,
    }


def verdict(**overrides) -> dict:
    result = {
        "verdict_category": "partial",
        "decision_label": "Partial payment",
        "confidence_score": 78,
        "payment_split": {"client": 40, "freelancer": 60},
        "explanation": ["Both submissions support partial performance."],
        "recommended_next_step": "split_payment",
    }
    result.update(overrides)
    return result


def test_both_parties_evidence_reaches_evaluator(
    direct_vm, direct_deploy, direct_alice
):
    contract = direct_deploy("contracts/dispute_resolver.py", sdk_version=SDK_VERSION)
    direct_vm.sender = direct_alice
    direct_vm.mock_llm(r".*You are EquiVerdict.*", json.dumps(verdict()))
    contract.submit_dispute(
        "case-both-sides",
        "A two-part website must be delivered before final payment.",
        "2500 USDC",
        [evidence("client", "The second part was absent.")],
        [evidence("freelancer", "The first part was accepted.", "delivery_note")],
    )

    stored = contract.get_dispute("case-both-sides")
    assert stored["client_evidence"][0]["summary"] == "The second part was absent."
    assert stored["freelancer_evidence"][0]["summary"] == "The first part was accepted."

    source = Path("contracts/dispute_resolver.py").read_text(encoding="utf-8")
    assert '"client_evidence": client_items' in source
    assert '"freelancer_evidence": freelancer_items' in source
    assert 'context_json = json.dumps(dispute_context' in source
    assert 'DISPUTE_CONTEXT:' in source and '""" + context_json' in source


def test_consensus_returned_verdict_is_persisted(
    direct_vm, direct_deploy, direct_alice
):
    contract = direct_deploy("contracts/dispute_resolver.py", sdk_version=SDK_VERSION)
    direct_vm.sender = direct_alice
    expected = verdict(
        verdict_category="favor_freelancer",
        decision_label="Release most payment",
        confidence_score="82",
        payment_split={"client": "15", "freelancer": "85"},
    )
    direct_vm.mock_llm(r".*You are EquiVerdict.*", json.dumps(expected))

    contract.submit_dispute(
        "case-consensus",
        "Payment follows delivery.",
        "900",
        [evidence("client", "Client reports a defect.")],
        [evidence("freelancer", "Delivery receipt was signed.", "delivery_note")],
    )
    stored = contract.get_dispute("case-consensus")["verdict"]

    assert stored["verdict_category"] == "favor_freelancer"
    assert stored["confidence_score"] == 82
    assert stored["payment_split"] == {"client": 15, "freelancer": 85}


@pytest.mark.parametrize(
    "bad_verdict",
    [
        verdict(confidence_score="75.5"),
        verdict(payment_split={"client": 40, "freelancer": 40}),
        verdict(verdict_category="unsupported_label"),
    ],
)
def test_malformed_nondeterministic_output_is_rejected(
    direct_vm, direct_deploy, direct_alice, bad_verdict
):
    contract = direct_deploy("contracts/dispute_resolver.py", sdk_version=SDK_VERSION)
    direct_vm.sender = direct_alice
    direct_vm.mock_llm(r".*You are EquiVerdict.*", json.dumps(bad_verdict))

    with direct_vm.expect_revert("[LLM_ERROR]"):
        contract.submit_dispute(
            "case-malformed",
            "Agreement",
            "100",
            [evidence("client", "Claim")],
            [evidence("freelancer", "Response")],
        )


def test_duplicate_and_invalid_disputes_fail_deterministically(
    direct_vm, direct_deploy, direct_alice
):
    contract = direct_deploy("contracts/dispute_resolver.py", sdk_version=SDK_VERSION)
    direct_vm.sender = direct_alice
    direct_vm.mock_llm(r".*You are EquiVerdict.*", json.dumps(verdict()))
    client = [evidence("client", "Claim")]

    with direct_vm.expect_revert("Case ID is required"):
        contract.submit_dispute(" ", "Agreement", "100", client, [])

    contract.submit_dispute("case-duplicate", "Agreement", "100", client, [])
    with direct_vm.expect_revert("Case ID already exists"):
        contract.submit_dispute("case-duplicate", "Agreement", "100", client, [])
