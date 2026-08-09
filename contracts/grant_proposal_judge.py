# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json


class GrantProposalJudge(gl.Contract):
    evaluations: TreeMap[str, str]
    evaluation_order: DynArray[str]

    def __init__(self):
        pass

    @gl.public.write
    def evaluate_proposal(
        self,
        proposal_id: str,
        title: str,
        proposal_text: str,
        criteria: str,
    ) -> None:
        proposal_id = proposal_id.strip()
        title = title.strip()
        proposal_text = proposal_text.strip()
        criteria = criteria.strip()

        if not proposal_id:
            raise gl.UserError("Proposal ID is required")
        if proposal_id in self.evaluations:
            raise gl.UserError("Proposal ID already exists")
        if not title:
            raise gl.UserError("Title is required")
        if not proposal_text:
            raise gl.UserError("Proposal text is required")
        if not criteria:
            raise gl.UserError("Funding criteria are required")

        evaluation = self._judge_proposal(title, proposal_text, criteria)
        stored = {
            "proposal_id": proposal_id,
            "title": title,
            "proposal_text": proposal_text,
            "criteria": criteria,
            "decision": evaluation["decision"],
            "confidence_score": evaluation["confidence_score"],
            "summary": evaluation["summary"],
            "strengths": evaluation["strengths"],
            "weaknesses": evaluation["weaknesses"],
            "recommendation": evaluation["recommendation"],
        }
        self.evaluations[proposal_id] = json.dumps(stored, sort_keys=True)
        self.evaluation_order.append(proposal_id)

    @gl.public.view
    def get_evaluation(self, proposal_id: str) -> dict:
        proposal_id = proposal_id.strip()
        if proposal_id not in self.evaluations:
            raise gl.UserError("Evaluation not found")
        return json.loads(self.evaluations[proposal_id])

    @gl.public.view
    def list_evaluations(self) -> list[dict]:
        return [
            json.loads(self.evaluations[proposal_id])
            for proposal_id in self.evaluation_order
        ]

    def _judge_proposal(
        self, title: str, proposal_text: str, criteria: str
    ) -> dict:
        prompt = f"""You are an independent grant proposal evaluator.

Evaluate the proposal strictly against the supplied funding criteria. Do not
invent missing facts or reward claims that are unsupported by the proposal.

Decision rules:
- eligible: the proposal substantively meets the criteria and is ready for funding consideration.
- needs_revision: the proposal has credible merit but material gaps must be resolved.
- not_eligible: the proposal conflicts with, or substantially fails to meet, the criteria.

Return one JSON object with exactly these fields:
{{
  "decision": "eligible" | "needs_revision" | "not_eligible",
  "confidence_score": integer from 0 through 100,
  "summary": "concise evidence-grounded assessment",
  "strengths": ["specific strength"],
  "weaknesses": ["specific weakness or missing information"],
  "recommendation": "clear next step for the funder or applicant"
}}

TITLE:
{title}

FUNDING CRITERIA:
{criteria}

PROPOSAL:
{proposal_text}
"""

        def evaluate() -> dict:
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            return self._normalize_evaluation(raw)

        def validate(leader_result: gl.vm.Result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False

            try:
                validator_evaluation = evaluate()
                leader_evaluation = leader_result.calldata

                if leader_evaluation["decision"] != validator_evaluation["decision"]:
                    return False

                leader_confidence = leader_evaluation["confidence_score"]
                validator_confidence = validator_evaluation["confidence_score"]
                if abs(leader_confidence - validator_confidence) > 15:
                    return False

                return True
            except Exception:
                return False

        return gl.vm.run_nondet_unsafe(evaluate, validate)

    def _normalize_evaluation(self, raw: dict) -> dict:
        if not isinstance(raw, dict):
            raise gl.vm.UserError("[LLM_ERROR] Evaluation must be a JSON object")

        decision = str(raw.get("decision", "")).strip().lower()
        if decision not in ("eligible", "needs_revision", "not_eligible"):
            raise gl.vm.UserError("[LLM_ERROR] Invalid grant decision")

        try:
            confidence_score = int(str(raw.get("confidence_score", "")).strip())
        except Exception:
            raise gl.vm.UserError("[LLM_ERROR] Invalid confidence score")
        if confidence_score < 0 or confidence_score > 100:
            raise gl.vm.UserError("[LLM_ERROR] Confidence score is out of range")

        summary = str(raw.get("summary", "")).strip()
        recommendation = str(raw.get("recommendation", "")).strip()
        strengths = self._normalize_string_list(raw.get("strengths", []))
        weaknesses = self._normalize_string_list(raw.get("weaknesses", []))

        if not summary or not recommendation:
            raise gl.vm.UserError("[LLM_ERROR] Incomplete grant evaluation")

        return {
            "decision": decision,
            "confidence_score": confidence_score,
            "summary": summary,
            "strengths": strengths,
            "weaknesses": weaknesses,
            "recommendation": recommendation,
        }

    def _normalize_string_list(self, raw_items: list) -> list[str]:
        if not isinstance(raw_items, list):
            raise gl.vm.UserError("[LLM_ERROR] Expected a JSON array")

        items = []
        for raw_item in raw_items[:8]:
            item = str(raw_item).strip()
            if item:
                items.append(item)
        return items
