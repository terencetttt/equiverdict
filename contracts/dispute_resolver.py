# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
import json


@allow_storage
@dataclass
class EvidenceItem:
    type: str
    role: str
    title: str
    summary: str
    importance: str
    timestamp: str
    url: str


class FreelanceDisputeResolver(gl.Contract):
    owner: Address
    cases: TreeMap[str, str]
    case_order: DynArray[str]

    def __init__(self):
        self.owner = gl.message.sender_address

    @gl.public.write
    def submit_dispute(
        self,
        case_id: str,
        agreement: str,
        disputed_amount: str,
        client_evidence: list[EvidenceItem],
        freelancer_evidence: list[EvidenceItem],
    ) -> None:
        if case_id in self.cases:
            raise gl.UserError("Case ID already exists")
        if not case_id.strip():
            raise gl.UserError("Case ID is required")
        if not agreement.strip():
            raise gl.UserError("Agreement text is required")
        if not disputed_amount.strip():
            raise gl.UserError("Disputed amount is required")
        if len(client_evidence) == 0 and len(freelancer_evidence) == 0:
            raise gl.UserError("At least one evidence item is required")

        client_items = [self._evidence_to_dict(item) for item in client_evidence]
        freelancer_items = [
            self._evidence_to_dict(item) for item in freelancer_evidence
        ]
        verdict = self._evaluate_dispute(client_items, freelancer_items)
        case_data = {
            "case_id": case_id,
            "agreement": agreement,
            "disputed_amount": disputed_amount,
            "status": "evaluated",
            "verdict": verdict,
            "client_evidence": client_items,
            "freelancer_evidence": freelancer_items,
            "submitted_by": gl.message.sender_address.as_hex,
        }
        self.cases[case_id] = json.dumps(case_data, sort_keys=True)
        self.case_order.append(case_id)

    @gl.public.view
    def get_dispute(self, case_id: str) -> dict:
        if case_id not in self.cases:
            raise gl.UserError("Case not found")
        return json.loads(self.cases[case_id])

    @gl.public.view
    def list_disputes(self) -> list[dict]:
        return [json.loads(self.cases[case_id]) for case_id in self.case_order]

    def _evidence_to_dict(self, item: dict) -> dict:
        return {
            "type": item["type"],
            "role": item["role"],
            "title": item["title"],
            "summary": item["summary"],
            "importance": item["importance"],
            "timestamp": item["timestamp"],
            "url": item["url"],
        }

    def _evaluate_dispute(
        self, client_items: list[dict], freelancer_items: list[dict]
    ) -> dict:
        client_score = self._score_items(client_items, "client")
        freelancer_score = self._score_items(freelancer_items, "freelancer")
        total_score = client_score + freelancer_score

        if total_score == 0:
            return {
                "verdict_category": "insufficient_evidence",
                "decision_label": "Insufficient evidence",
                "confidence_score": 40,
                "payment_split": {"client": 0, "freelancer": 0},
                "explanation": ["No evidence details could be evaluated."],
                "recommended_next_step": "gather_more_evidence",
            }

        client_share = (client_score * 100) // total_score
        freelancer_share = 100 - client_share
        if client_score > freelancer_score:
            verdict_category = "favor_client"
            decision_label = "Favor client"
            next_step = "issue_refund"
        elif freelancer_score > client_score:
            verdict_category = "favor_freelancer"
            decision_label = "Favor freelancer"
            next_step = "release_payment"
        else:
            verdict_category = "partial"
            decision_label = "Partial resolution"
            next_step = "split_payment"

        confidence_score = min(
            95, 50 + abs(client_score - freelancer_score) * 5
        )
        return {
            "verdict_category": verdict_category,
            "decision_label": decision_label,
            "confidence_score": confidence_score,
            "payment_split": {
                "client": client_share,
                "freelancer": freelancer_share,
            },
            "explanation": [
                "Client evidence score: " + str(client_score) + ".",
                "Freelancer evidence score: " + str(freelancer_score) + ".",
                "The contract evaluated evidence importance and evidence type relevance.",
            ],
            "recommended_next_step": next_step,
        }

    def _score_items(self, items: list[dict], side: str) -> int:
        score = 0
        for item in items:
            if item["importance"] == "high":
                score += 3
            elif item["importance"] == "medium":
                score += 2
            else:
                score += 1

            if side == "client" and item["type"] in (
                "milestone",
                "chat",
                "delivery_note",
            ):
                score += 1
            if side == "freelancer" and item["type"] in (
                "screenshot_link",
                "invoice",
                "delivery_note",
            ):
                score += 1
        return score
