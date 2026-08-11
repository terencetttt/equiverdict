# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
from dataclasses import dataclass
import json


ERROR_LLM = "[LLM_ERROR]"
VERDICT_CATEGORIES = (
    "favor_client",
    "favor_freelancer",
    "split",
    "insufficient_evidence",
)
NEXT_STEPS = (
    "refund_client",
    "release_freelancer",
    "split_payment",
    "request_more_evidence",
)


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
        # These checks are deliberately deterministic. They validate the request;
        # they do not decide which party should prevail.
        if case_id in self.cases:
            raise gl.vm.UserError("Case ID already exists")
        if not case_id.strip():
            raise gl.vm.UserError("Case ID is required")
        if not agreement.strip():
            raise gl.vm.UserError("Agreement text is required")
        if not disputed_amount.strip():
            raise gl.vm.UserError("Disputed amount is required")
        if len(client_evidence) == 0 and len(freelancer_evidence) == 0:
            raise gl.vm.UserError("At least one evidence item is required")

        client_items = [
            self._evidence_to_dict(item, "client") for item in client_evidence
        ]
        freelancer_items = [
            self._evidence_to_dict(item, "freelancer")
            for item in freelancer_evidence
        ]
        dispute_context = {
            "case_id": case_id,
            "agreement": agreement,
            "case_description": agreement,
            "disputed_amount": disputed_amount,
            "client_evidence": client_items,
            "freelancer_evidence": freelancer_items,
        }

        # Validators independently rerun the same dispute evaluation and compare
        # its stable decision fields. Only the consensus-backed verdict is returned.
        verdict = self._evaluate_dispute(dispute_context)
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
            raise gl.vm.UserError("Case not found")
        return json.loads(self.cases[case_id])

    @gl.public.view
    def list_disputes(self) -> list[dict]:
        return [json.loads(self.cases[case_id]) for case_id in self.case_order]

    def _evidence_to_dict(self, item: dict, expected_role: str) -> dict:
        result = {
            "type": item["type"].strip(),
            "role": item["role"].strip(),
            "title": item["title"].strip(),
            "summary": item["summary"].strip(),
            "importance": item["importance"].strip(),
            "timestamp": item["timestamp"].strip(),
            "url": item["url"].strip(),
        }
        if result["role"] != expected_role:
            raise gl.vm.UserError("Evidence role does not match its submitted party")
        if not result["type"] or not result["summary"]:
            raise gl.vm.UserError("Evidence type and summary are required")
        return result

    def _evaluate_dispute(self, dispute_context: dict) -> dict:
        context_json = json.dumps(dispute_context, sort_keys=True)
        prompt = """You are EquiVerdict, a neutral adjudicator for a freelance dispute.

Assess ONLY the submitted agreement/case description, disputed amount, and the
verifiable evidence supplied by the client and freelancer in DISPUTE_CONTEXT.
Treat both parties neutrally. Do not invent, assume, or import facts. A URL is
metadata unless its contents are actually included in the submitted evidence.
Consider every evidence item's type, importance, summary, timestamp, URL, and
role, while judging credibility and relevance from the submitted material only.

Return one JSON-safe object with exactly these fields:
- verdict_category: one of favor_client, favor_freelancer, split,
  insufficient_evidence
- decision_label: concise human-readable decision
- confidence_score: integer from 0 through 100
- payment_split: object with integer client and freelancer percentages totaling 100
- explanation: concise narrative text grounded in the submissions
- recommended_next_step: one of refund_client, release_freelancer,
  split_payment, request_more_evidence

Never use floats. Never omit a field. Do not wrap the object in markdown.

DISPUTE_CONTEXT:
""" + context_json

        def evaluate() -> dict:
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            return self._normalize_verdict(raw)

        def validate(leader_result: gl.vm.Result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            validator_verdict = evaluate()
            leader_verdict = leader_result.calldata

            if leader_verdict["verdict_category"] != validator_verdict["verdict_category"]:
                return False
            if leader_verdict["recommended_next_step"] != validator_verdict["recommended_next_step"]:
                return False
            if abs(leader_verdict["confidence_score"] - validator_verdict["confidence_score"]) > 25:
                return False
            if abs(
                leader_verdict["payment_split"]["client"]
                - validator_verdict["payment_split"]["client"]
            ) > 25:
                return False
            return True

        return gl.vm.run_nondet_unsafe(evaluate, validate)

    def _normalize_verdict(self, raw: dict) -> dict:
        if not isinstance(raw, dict):
            raise gl.vm.UserError(ERROR_LLM + " Verdict must be a JSON object")

        category = raw.get("verdict_category")
        label = raw.get("decision_label")
        next_step = raw.get("recommended_next_step")
        explanation = raw.get("explanation")
        split = raw.get("payment_split")
        confidence = self._required_int(raw.get("confidence_score"), "confidence_score")

        if category not in VERDICT_CATEGORIES:
            raise gl.vm.UserError(ERROR_LLM + " Invalid verdict_category")
        if not isinstance(label, str) or not label.strip():
            raise gl.vm.UserError(ERROR_LLM + " Invalid decision_label")
        if not isinstance(next_step, str) or not next_step.strip():
            raise gl.vm.UserError(ERROR_LLM + " Invalid recommended_next_step")
        if next_step not in NEXT_STEPS:
            raise gl.vm.UserError(ERROR_LLM + " Invalid recommended_next_step")
        if confidence < 0 or confidence > 100:
            raise gl.vm.UserError(ERROR_LLM + " confidence_score must be 0-100")
        if not isinstance(split, dict):
            raise gl.vm.UserError(ERROR_LLM + " payment_split must be an object")

        client = self._required_int(split.get("client"), "payment_split.client")
        freelancer = self._required_int(
            split.get("freelancer"), "payment_split.freelancer"
        )
        if client < 0 or client > 100 or freelancer < 0 or freelancer > 100:
            raise gl.vm.UserError(ERROR_LLM + " Payment percentages must be 0-100")
        if client + freelancer != 100:
            raise gl.vm.UserError(ERROR_LLM + " Payment percentages must total 100")

        if not isinstance(explanation, str) or not explanation.strip():
            raise gl.vm.UserError(ERROR_LLM + " explanation must be narrative text")

        expected_step = {
            "favor_client": "refund_client",
            "favor_freelancer": "release_freelancer",
            "split": "split_payment",
            "insufficient_evidence": "request_more_evidence",
        }[category]
        if next_step != expected_step:
            raise gl.vm.UserError(ERROR_LLM + " recommended_next_step conflicts with verdict")
        if category == "favor_client" and client <= freelancer:
            raise gl.vm.UserError(ERROR_LLM + " payment_split conflicts with verdict")
        if category == "favor_freelancer" and freelancer <= client:
            raise gl.vm.UserError(ERROR_LLM + " payment_split conflicts with verdict")
        if category == "split" and (client == 0 or freelancer == 0):
            raise gl.vm.UserError(ERROR_LLM + " split verdict must pay both parties")

        return {
            "verdict_category": category,
            "decision_label": label.strip(),
            "confidence_score": confidence,
            "payment_split": {"client": client, "freelancer": freelancer},
            "explanation": explanation.strip(),
            "recommended_next_step": next_step.strip(),
        }

    def _required_int(self, value, field_name: str) -> int:
        # Integer strings are normalized safely; bools and floats are rejected.
        if isinstance(value, bool):
            raise gl.vm.UserError(ERROR_LLM + " " + field_name + " must be an integer")
        if isinstance(value, int):
            return value
        if isinstance(value, str):
            cleaned = value.strip()
            if cleaned.startswith("-"):
                digits = cleaned[1:]
            else:
                digits = cleaned
            if digits.isdigit() and digits:
                return int(cleaned)
        raise gl.vm.UserError(ERROR_LLM + " " + field_name + " must be an integer")
