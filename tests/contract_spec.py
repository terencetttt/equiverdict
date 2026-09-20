"""Offline executable contract specification for the current public ABI."""
import ast
from pathlib import Path

SOURCE = Path("contracts/dispute_resolver.py")


def test_current_public_lifecycle_abi():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef))
    methods = {node.name: node for node in cls.body if isinstance(node, ast.FunctionDef)}
    expected = {
        "create_dispute": ["case_id", "freelancer_wallet", "agreement", "disputed_amount"],
        "accept_agreement": ["case_id", "agreement_sha256"],
        "submit_evidence": ["case_id", "evidence_type", "title", "description", "importance", "timestamp", "evidence_uri", "evidence_sha256", "accepted_agreement_sha256"],
        "freeze_evidence": ["case_id"],
        "evaluate_dispute": ["case_id"],
        "get_dispute": ["case_id"],
        "list_disputes": [],
    }
    for name, parameters in expected.items():
        node = methods[name]
        assert [arg.arg for arg in node.args.args[1:]] == parameters
        assert ast.unparse(node.decorator_list[0]) == ("gl.public.view" if name in ("get_dispute", "list_disputes") else "gl.public.write")
    assert "submit_dispute" not in methods


def test_pinned_runner_and_payment_tolerance():
    source = SOURCE.read_text(encoding="utf-8")
    assert 'py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6' in source.splitlines()[0]
    tree = ast.parse(source)
    values = {node.targets[0].id: node.value.value for node in tree.body if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant)}
    assert values["PAYMENT_TOLERANCE"] == 5
