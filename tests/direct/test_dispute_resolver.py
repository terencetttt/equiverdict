import ast
import pathlib

import pytest

SDK_VERSION = "v0.2.12"
CONTRACT_PATH = "contracts/dispute_resolver.py"
SOURCE_PATH = pathlib.Path(CONTRACT_PATH)

CLIENT = bytes.fromhex("11" * 20)
FREELANCER = bytes.fromhex("22" * 20)
OUTSIDER = bytes.fromhex("33" * 20)
VALID_HASH = "a" * 64


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


def create_case(contract, direct_vm, case_id="case-1"):
    direct_vm.sender = CLIENT
    contract.create_dispute(
        case_id,
        contract_address(FREELANCER),
        '{"title":"Test dispute","clientName":"Client","freelancerName":"Freelancer"}',
        "100",
    )


def submit(
    contract,
    direct_vm,
    sender,
    case_id="case-1",
    uri="https://example.com/evidence.txt",
    digest=VALID_HASH,
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
        "Freelancer evidence is required before evaluation"
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
    helper_start = source.index("def _fetch_verified_evidence")
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

    assert "_fetch_verified_evidence(item)" in evaluate_body
    assert "gl.nondet.exec_prompt(" in evaluate_body
    assert evaluate_body.index("_fetch_verified_evidence(item)") < evaluate_body.index("gl.nondet.exec_prompt(")


def test_consensus_path_is_preserved_in_contract_source():
    source = SOURCE_PATH.read_text(encoding="utf-8")

    assert "def validate(leader_result: gl.vm.Result) -> bool:" in source
    assert "validator_verdict = evaluate()" in source
    assert "return gl.vm.run_nondet_unsafe(evaluate, validate)" in source
    assert "CONFIDENCE_TOLERANCE = 25" in source
    assert "PAYMENT_TOLERANCE = 25" in source
