from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Account
from ..schemas import (
    TransferAcknowledgeRequest,
    TransferAcknowledgeResponse,
    TransferMatchingResponse,
    TransferMatchResponse,
    UnmatchedTransferLegResponse,
)
from ..services.transfer_matching import (
    acknowledge_transfer,
    transfer_analysis,
    unacknowledge_transfer,
)

router = APIRouter()


@router.get("/transfers", response_model=TransferMatchingResponse)
def get_transfer_matches(db: Session = Depends(get_db)):
    """Candidate transfer pairs (matched by amount and date proximity across
    two different accounts - see services/transfer_matching.py) and any
    transfer-categorized transaction with no matching counterpart. Nothing
    here ever changes a transaction's own category - see that module's
    docstring for why.
    """

    matches, unmatched, ack_matches, ack_unmatched = transfer_analysis(db, return_acknowledged=True)

    # One small lookup rather than joining Account into transfer_candidates'
    # own query - that function already has everything it needs (account
    # IDs) to do the matching itself; names are purely a display concern
    # for this endpoint's response.
    account_names = dict(db.query(Account.id, Account.name).all())

    def _match_response(m):
        return TransferMatchResponse(
            leg_a_id=m.leg_a_id,
            leg_a_account_id=m.leg_a_account_id,
            leg_a_account_name=account_names.get(m.leg_a_account_id, ""),
            leg_a_date=m.leg_a_date,
            leg_a_category_name=m.leg_a_category_name,
            leg_a_is_transfer=m.leg_a_is_transfer,
            leg_b_id=m.leg_b_id,
            leg_b_account_id=m.leg_b_account_id,
            leg_b_account_name=account_names.get(m.leg_b_account_id, ""),
            leg_b_date=m.leg_b_date,
            leg_b_category_name=m.leg_b_category_name,
            leg_b_is_transfer=m.leg_b_is_transfer,
            amount=m.amount,
            both_categorized_as_transfer=m.both_categorized_as_transfer,
        )

    def _unmatched_response(t):
        return UnmatchedTransferLegResponse(
            transaction_id=t.id,
            account_id=t.account_id,
            account_name=account_names.get(t.account_id, ""),
            transaction_date=t.transaction_date,
            narration=t.narration,
            amount=t.debit if t.debit is not None else t.credit,
        )

    return TransferMatchingResponse(
        matches=[_match_response(m) for m in matches],
        unmatched=[_unmatched_response(t) for t in unmatched],
        acknowledged_matches=[_match_response(m) for m in ack_matches],
        acknowledged_unmatched=[_unmatched_response(t) for t in ack_unmatched],
    )


@router.post("/transfers/acknowledge", response_model=TransferAcknowledgeResponse, status_code=201)
def acknowledge_transfer_endpoint(payload: TransferAcknowledgeRequest, db: Session = Depends(get_db)):
    """Acknowledge a candidate transfer pair or unmatched transfer leg so it is
    hidden from the active transfer matching view.
    """
    if payload.transaction_id is None and (payload.leg_a_id is None or payload.leg_b_id is None):
        raise HTTPException(
            status_code=422,
            detail="Either transaction_id or both leg_a_id and leg_b_id must be provided",
        )

    try:
        ack = acknowledge_transfer(
            db,
            leg_a_id=payload.leg_a_id,
            leg_b_id=payload.leg_b_id,
            transaction_id=payload.transaction_id,
        )
        return ack
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/transfers/unacknowledge", status_code=200)
def unacknowledge_transfer_endpoint(payload: TransferAcknowledgeRequest, db: Session = Depends(get_db)):
    """Remove acknowledgment from a previously acknowledged transfer pair or
    unmatched leg, restoring it to the active view.
    """
    if payload.transaction_id is None and (payload.leg_a_id is None or payload.leg_b_id is None):
        raise HTTPException(
            status_code=422,
            detail="Either transaction_id or both leg_a_id and leg_b_id must be provided",
        )

    removed = unacknowledge_transfer(
        db,
        leg_a_id=payload.leg_a_id,
        leg_b_id=payload.leg_b_id,
        transaction_id=payload.transaction_id,
    )
    return {"unacknowledged": removed}
