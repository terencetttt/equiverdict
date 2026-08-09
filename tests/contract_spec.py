from gltest import get_contract_factory
from gltest.assertions import tx_execution_succeeded


def test_evaluate_dispute_even_split():
    factory = get_contract_factory("FreelanceDisputeResolver")
    contract = factory.deploy(args=[])

    client_evidence = [
        {
            "type": "chat",
            "role": "client",
            "title": "Client claim",
            "summary": "Client says milestones are missing",
            "importance": "high",
            "timestamp": "2026-08-06",
            "url": "",
        }
    ]

    freelancer_evidence = [
        {
            "type": "invoice",
            "role": "freelancer",
            "title": "Invoice",
            "summary": "Freelancer delivered milestone",
            "importance": "high",
            "timestamp": "2026-08-06",
            "url": "",
        }
    ]

    tx = contract.submit_dispute(
        args=[
            "case1",
            "Agreement text",
            "1000",
            client_evidence,
            freelancer_evidence,
        ]
    )

    assert tx_execution_succeeded(tx)

    dispute = contract.get_dispute(args=["case1"])

    assert dispute["verdict"]["verdict_category"] in [
        "favor_client",
        "favor_freelancer",
        "partial",
    ]