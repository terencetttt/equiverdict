import ast
import copy
import hashlib
import json
from types import SimpleNamespace
import pathlib

import pytest

SDK_VERSION = "v0.2.12"
CONTRACT_PATH = "contracts/dispute_resolver.py"
SOURCE_PATH = pathlib.Path(CONTRACT_PATH)

CLIENT = bytes.fromhex("11" * 20)
FREELANCER = bytes.fromhex("22" * 20)
OUTSIDER = bytes.fromhex("33" * 20)
VALID_HASH = "a" * 64


@pytest.fixture(autouse=True)
def windows_direct_stdin_compat(monkeypatch):
    """gltest unlinks its stdin file while open; Windows requires deferred cleanup."""
    import os
    if os.name != "nt":
        yield
        return
    from gltest.direct import loader
    original = loader._inject_message_to_fd0
    saved_stdin = os.dup(0)
    pending = []
    saved_descriptors = set()

    def inject(vm):
        try:
            original(vm)
        except PermissionError as error:
            # Suppress only the known final unlink failure, after injection.
            import traceback
            frame = traceback.extract_tb(error.__traceback__)[-1]
            if error.winerror != 32 or frame.name != "_inject_message_to_fd0" or "os.unlink(path)" not in (frame.line or ""):
                raise
            pending.append(error.filename)
        finally:
            descriptor = getattr(vm, "_original_stdin_fd", None)
            if descriptor is not None:
                saved_descriptors.add(descriptor)

    monkeypatch.setattr(loader, "_inject_message_to_fd0", inject)
    try:
        yield
    finally:
        os.dup2(saved_stdin, 0)
        os.close(saved_stdin)
        for descriptor in saved_descriptors:
            try:
                os.close(descriptor)
            except OSError:
                pass  # VM teardown may already have closed it.
        for path in pending:
            os.unlink(path)


def address_hex(value: bytes) -> str:
    return "0x" + value.hex()


def contract_address(value: bytes):
    # gltest's direct wrapper does not coerce raw bytes into the annotated
    # GenLayer Address type for public-method parameters.
    from genlayer.py.types import Address
    return Address(value)


def deploy(direct_vm, direct_deploy):
    direct_vm.sender = CLIENT
    return direct_deploy(CONTRACT_PATH, sdk_version=SDK_VERSION)


def create_case(contract, direct_vm, case_id="case-1", accepted=True):
    direct_vm.sender = CLIENT
    contract.create_dispute(
        case_id,
        contract_address(FREELANCER),
        '{"title":"Test dispute","clientName":"Client","freelancerName":"Freelancer"}',
        "100",
    )
    if accepted:
        digest = contract.get_dispute(case_id)["agreement_sha256"]
        contract.accept_agreement(case_id, digest)
        direct_vm.sender = FREELANCER
        contract.accept_agreement(case_id, digest)


def submit(
    contract,
    direct_vm,
    sender,
    case_id="case-1",
    uri="https://example.com/evidence.txt",
    digest=VALID_HASH,
    agreement_hash=None,
):
    direct_vm.sender = sender
    contract.submit_evidence(
        case_id,
        "document",
        "Evidence title",
        "Evidence context",
        "high",
        "2026-08-29T12:00:00.000Z",
        uri,
        digest,
        agreement_hash or contract.get_dispute(case_id)["agreement_sha256"],
    )


def test_same_wallet_rejected(direct_vm, direct_deploy):
    contract = deploy(direct_vm, direct_deploy)
    direct_vm.sender = CLIENT

    with direct_vm.expect_revert("Client and freelancer must be different wallets"):
        contract.create_dispute(
            "same-wallet",
            contract_address(CLIENT),
            "Agreement",
            "100",
        )


def test_separate_party_wallets_are_immutable_on_case(direct_vm, direct_deploy):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm)

    dispute = contract.get_dispute("case-1")

    assert dispute["client_wallet"].lower() == address_hex(CLIENT)
    assert dispute["freelancer_wallet"].lower() == address_hex(FREELANCER)
    assert dispute["client_wallet"].lower() != dispute["freelancer_wallet"].lower()


def test_unrelated_wallet_cannot_submit_evidence(direct_vm, direct_deploy):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm)

    with direct_vm.expect_revert(
        "Only a party bound to this dispute can submit evidence"
    ):
        submit(contract, direct_vm, OUTSIDER)


def test_client_submission_gets_client_role_from_sender(direct_vm, direct_deploy):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm)

    submit(contract, direct_vm, CLIENT)
    dispute = contract.get_dispute("case-1")
    item = dispute["client_evidence"][0]

    assert item["role"] == "client"
    assert item["submitting_wallet"].lower() == address_hex(CLIENT)
    assert len(dispute["freelancer_evidence"]) == 0


def test_freelancer_submission_gets_freelancer_role_from_sender(
    direct_vm, direct_deploy
):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm)

    submit(contract, direct_vm, FREELANCER)
    dispute = contract.get_dispute("case-1")
    item = dispute["freelancer_evidence"][0]

    assert item["role"] == "freelancer"
    assert item["submitting_wallet"].lower() == address_hex(FREELANCER)
    assert len(dispute["client_evidence"]) == 0


def test_role_cannot_be_forged_through_public_submit_api():
    tree = ast.parse(SOURCE_PATH.read_text(encoding="utf-8"))
    submit_method = None

    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == "submit_evidence":
            submit_method = node
            break

    assert submit_method is not None
    parameter_names = [arg.arg for arg in submit_method.args.args]
    assert "role" not in parameter_names
    assert "submitting_wallet" not in parameter_names


def test_non_https_evidence_is_rejected(direct_vm, direct_deploy):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm)

    with direct_vm.expect_revert("Evidence URI must use HTTPS"):
        submit(
            contract,
            direct_vm,
            CLIENT,
            uri="http://example.com/evidence.txt",
        )


@pytest.mark.parametrize(
    "digest",
    [
        "",
        "abc123",
        "g" * 64,
        "a" * 63,
        "a" * 65,
    ],
)
def test_malformed_sha256_is_rejected(direct_vm, direct_deploy, digest):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm)

    with direct_vm.expect_revert(
        "Evidence SHA-256 must be a 64-character hexadecimal digest"
    ):
        submit(contract, direct_vm, CLIENT, digest=digest)


def test_both_parties_required_before_evaluation(direct_vm, direct_deploy):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm)
    submit(contract, direct_vm, CLIENT)

    direct_vm.sender = CLIENT
    with direct_vm.expect_revert(
        "Evidence must be frozen before evaluation"
    ):
        contract.evaluate_dispute("case-1")


def test_outsider_cannot_request_evaluation(direct_vm, direct_deploy):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm)

    direct_vm.sender = OUTSIDER
    with direct_vm.expect_revert(
        "Only a party bound to this dispute can request evaluation"
    ):
        contract.evaluate_dispute("case-1")


def test_validator_fetch_hash_check_happens_before_llm_use():
    source = SOURCE_PATH.read_text(encoding="utf-8")

    # Verify the fetch helper itself performs HTTP -> hash -> compare -> content.
    helper_start = source.index("def verified_inputs")
    helper_end = source.index("def _normalize_verdict", helper_start)
    helper = source[helper_start:helper_end]

    fetch_pos = helper.index("response = gl.nondet.web.get(uri)")
    status_pos = helper.index("if response.status != 200")
    hash_pos = helper.index("actual_hash = hashlib.sha256(body).hexdigest()")
    compare_pos = helper.index("if actual_hash != expected_hash")
    verified_content_pos = helper.index('verified["verified_content"] = content[:12000]')

    assert fetch_pos < status_pos < hash_pos < compare_pos < verified_content_pos

    # Verify evaluate() obtains verified evidence before invoking the LLM.
    evaluate_start = source.index("def evaluate() -> dict:")
    validate_start = source.index("def validate(", evaluate_start)
    evaluate_body = source[evaluate_start:validate_start]

    assert "gl.nondet.web.get(uri)" in evaluate_body
    assert "gl.nondet.exec_prompt(" in evaluate_body
    assert evaluate_body.index("gl.nondet.web.get(uri)") < evaluate_body.index("gl.nondet.exec_prompt(")


def test_consensus_path_is_preserved_in_contract_source():
    source = SOURCE_PATH.read_text(encoding="utf-8")

    assert "def validate(leader_result: gl.vm.Result) -> bool:" in source
    assert "validator_verdict = evaluate()" in source
    assert "return gl.vm.run_nondet_unsafe(evaluate, validate)" in source
    assert "CONFIDENCE_TOLERANCE = 25" in source
    assert "PAYMENT_TOLERANCE = 5" in source


@pytest.mark.parametrize("operation", ["accept", "submit"])
def test_wrong_agreement_hash_rejected(direct_vm, direct_deploy, operation):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm)
    direct_vm.sender = CLIENT
    with direct_vm.expect_revert("Agreement hash" if operation == "accept" else "Evidence must reference"):
        if operation == "accept":
            contract.accept_agreement("case-1", "0" * 64)
        else:
            submit(contract, direct_vm, CLIENT, agreement_hash="0" * 64)


def test_outsider_acceptance_rejected(direct_vm, direct_deploy):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm, accepted=False)
    direct_vm.sender = OUTSIDER
    with direct_vm.expect_revert("Only a party bound"):
        contract.accept_agreement("case-1", contract.get_dispute("case-1")["agreement_sha256"])


@pytest.mark.parametrize("one_acceptance", [False, True])
def test_evidence_and_freeze_require_mutual_acceptance(direct_vm, direct_deploy, one_acceptance):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm, accepted=False)
    if one_acceptance:
        contract.accept_agreement("case-1", contract.get_dispute("case-1")["agreement_sha256"])
    with direct_vm.expect_revert("Both parties must accept"):
        submit(contract, direct_vm, CLIENT)
    with direct_vm.expect_revert("Both parties must accept"):
        contract.freeze_evidence("case-1")


@pytest.mark.parametrize("one_submission", [False, True])
def test_empty_or_one_sided_freeze_rejected(direct_vm, direct_deploy, one_submission):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm)
    if one_submission:
        submit(contract, direct_vm, CLIENT)
    with direct_vm.expect_revert("Both parties must submit evidence"):
        contract.freeze_evidence("case-1")


def test_freeze_lifecycle_and_deterministic_root(direct_vm, direct_deploy):
    roots = []
    contract = deploy(direct_vm, direct_deploy)
    snapshot = direct_vm.snapshot()
    for _ in range(2):
        direct_vm.revert(snapshot)
        create_case(contract, direct_vm)
        submit(contract, direct_vm, FREELANCER)
        submit(contract, direct_vm, CLIENT)
        before = contract.get_dispute("case-1")
        assert not before["evidence_frozen"] and before["evidence_root"] == ""
        with direct_vm.expect_revert("Evidence must be frozen"):
            contract.evaluate_dispute("case-1")
        direct_vm.sender = OUTSIDER
        with direct_vm.expect_revert("Only a party bound"):
            contract.freeze_evidence("case-1")
        direct_vm.sender = CLIENT
        contract.freeze_evidence("case-1")
        frozen = contract.get_dispute("case-1")
        ordered = before["freelancer_evidence"] + before["client_evidence"]
        expected = hashlib.sha256(json.dumps(ordered, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
        assert frozen["evidence_frozen"] and frozen["evidence_root"] == expected
        assert contract.list_disputes()[0]["evidence_root"] == expected
        assert expected != hashlib.sha256(json.dumps(list(reversed(ordered)), sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        roots.append(expected)
        with direct_vm.expect_revert("Evidence is frozen"):
            submit(contract, direct_vm, CLIENT)
        with direct_vm.expect_revert("Evidence is already frozen"):
            contract.freeze_evidence("case-1")
    assert roots[0] == roots[1]


CHECKS = ("material_finding_support", "evidence_citation_support", "explanation_consistency", "payout_outcome_consistency")
BODY = b"Only half of the agreed work was delivered."


def verdict():
    return dict(verdict_category="split", decision_label="Partial delivery", confidence_score=80,
                payment_split={"client": 50, "freelancer": 50},
                explanation="Half of the work was delivered, so each party receives half of the disputed amount.",
                recommended_next_step="split_payment",
                material_findings=[{"finding": "Half the agreed work was delivered.", "evidence_ids": ["evidence-1"]}])


@pytest.fixture
def validator_harness():
    # Execute the actual contract methods with a small VM adapter: direct mode
    # itself runs only the leader and cannot exercise validator callbacks.
    tree = ast.parse(SOURCE_PATH.read_text(encoding="utf-8"))
    tree.body = [node for node in tree.body if not isinstance(node, ast.ImportFrom)]
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef))
    cls.bases = []
    cls.body = [node for node in cls.body if not isinstance(node, ast.AnnAssign)]
    for node in cls.body:
        if isinstance(node, ast.FunctionDef):
            node.decorator_list = []
    tree.body.insert(0, ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0))
    class Return:
        def __init__(self, value):
            self.calldata = value
    gl = SimpleNamespace(vm=SimpleNamespace(UserError=ValueError, Return=Return),
                         message=SimpleNamespace(sender_address=SimpleNamespace(as_hex=address_hex(CLIENT))),
                         nondet=SimpleNamespace(web=SimpleNamespace()))
    namespace = {"gl": gl}
    exec(compile(ast.fix_missing_locations(tree), str(SOURCE_PATH), "exec"), namespace)
    contract = namespace["FreelanceDisputeResolver"]()
    contract.cases, contract.case_order = {}, []
    contract.create_dispute("case-1", SimpleNamespace(as_hex=address_hex(FREELANCER)), "Deliver the agreed work.", "100")
    digest = contract.get_dispute("case-1")["agreement_sha256"]
    for wallet in (CLIENT, FREELANCER):
        gl.message.sender_address.as_hex = address_hex(wallet)
        contract.accept_agreement("case-1", digest)
    for wallet in (CLIENT, FREELANCER):
        gl.message.sender_address.as_hex = address_hex(wallet)
        contract.submit_evidence("case-1", "document", "Delivery", "Claim", "high", "2026-09-19", "https://example.com/proof", hashlib.sha256(BODY).hexdigest(), digest)
    contract.freeze_evidence("case-1")
    return contract, gl, Return


def run_validator(harness, proposed=None, independent=None, failed_check=None, body=BODY):
    contract, gl, Return = harness
    proposed = proposed or verdict()
    independent = independent or verdict()
    calls = []
    def prompt(text, response_format):
        calls.append(text)
        if text.startswith("Validate semantic grounding"):
            payload = json.loads(text.split("\n", 1)[1])
            assert payload["verified_context"]["client_evidence"][0]["verified_content"] == BODY.decode()
            assert payload["verified_context"]["evidence_root"] == contract.get_dispute("case-1")["evidence_root"]
            assert payload["proposed_verdict"] == proposed
            return {key: key != failed_check for key in CHECKS}
        return copy.deepcopy(independent)
    gl.nondet.exec_prompt = prompt
    gl.nondet.web.get = lambda uri: SimpleNamespace(status=200, body=body)
    results = []
    def nondet(leader, validate):
        result = validate(Return(proposed))
        results.append(result)
        if not result:
            raise ValueError("Validator rejected verdict")
        return proposed
    gl.vm.run_nondet_unsafe = nondet
    try:
        contract.evaluate_dispute("case-1")
    except ValueError as error:
        assert str(error) == "Validator rejected verdict"
        assert contract.get_dispute("case-1")["status"] == "evidence_frozen"
    return results[0], calls


@pytest.mark.parametrize("delta,accepted", [(0, True), (5, True), (6, False)])
def test_payment_tolerance_boundaries(validator_harness, delta, accepted):
    independent = verdict()
    independent["payment_split"] = {"client": 50 + delta, "freelancer": 50 - delta}
    assert run_validator(validator_harness, independent=independent)[0] is accepted


@pytest.mark.parametrize("location", ["finding", "explanation", "decision_label"])
def test_nonexistent_citation_rejected(validator_harness, location):
    proposed = verdict()
    if location == "finding":
        proposed["material_findings"][0]["evidence_ids"] = ["evidence-999"]
    else:
        proposed[location] += " Supported by evidence-999."
    accepted, calls = run_validator(validator_harness, proposed=proposed)
    assert not accepted and not calls


@pytest.mark.parametrize("check", CHECKS)
def test_validator_rejects_unsupported_or_contradictory_verdict(validator_harness, check):
    proposed = verdict()
    if check == "material_finding_support":
        proposed["material_findings"][0]["finding"] = "All work was delivered."
    elif check == "evidence_citation_support":
        proposed["material_findings"][0]["finding"] = "The client paid a bonus."
    elif check == "explanation_consistency":
        proposed["explanation"] = "No work was delivered according to evidence-1."
    else:
        proposed["explanation"] = "Half the work was delivered; refund the entire amount to the client."
    accepted, calls = run_validator(validator_harness, proposed=proposed, failed_check=check)
    assert not accepted
    assert any(text.startswith("Validate semantic grounding") for text in calls)


def test_grounded_verdict_accepted(validator_harness):
    assert run_validator(validator_harness)[0]
    record = validator_harness[0].get_dispute("case-1")
    assert record["status"] == "evaluated"
    assert record["verdict"] == verdict()


def test_validator_hash_mismatch_rejected_before_prompt(validator_harness):
    accepted, calls = run_validator(validator_harness, body=b"tampered")
    assert not accepted and not calls


def test_direct_full_lifecycle(direct_vm, direct_deploy):
    contract = deploy(direct_vm, direct_deploy)
    create_case(contract, direct_vm)
    for wallet in (CLIENT, FREELANCER):
        submit(contract, direct_vm, wallet, digest=hashlib.sha256(BODY).hexdigest())
    contract.freeze_evidence("case-1")
    direct_vm.mock_web(r".*example.com/.*", {"status": 200, "body": BODY.decode()})
    direct_vm.mock_llm(r".*", json.dumps(verdict()))
    contract.evaluate_dispute("case-1")
    assert contract.get_dispute("case-1")["verdict"] == verdict()
