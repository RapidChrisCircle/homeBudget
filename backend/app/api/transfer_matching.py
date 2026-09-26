from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import Account
from ..schemas import TransferMatchingResponse, TransferMatchResponse, UnmatchedTransferLegResponse
from ..services.transfer_matching import transfer_candidates, unmatched_transfer_legs

router = APIRouter()


@router.get("/transfers", response_model=TransferMatchingResponse)
def get_transfer_matches(db: Session = Depends(get_db)):
    """Candidate transfer pairs (matched by amount and date proximity across
    two different accounts - see services/transfer_matching.py) and any
    transfer-categorized transaction with no matching counterpart. Nothing
    here ever changes a transaction's own category - see that module's
    docstring for why.
    """

    matches = transfer_candidates(db)
    unmatched = unmatched_transfer_legs(db, matches)

    # One small lookup rather than joining Account into transfer_candidates'
    # own query - that function already has everything it needs (account
    # IDs) to do the matching itself; names are purely a display concern
    # for this endpoint's response.
    account_names = dict(db.query(Account.id, Account.name).all())

    return TransferMatchingResponse(
        matches=[
            TransferMatchResponse(
                leg_a_id=m.leg_a_id,
                leg_a_account_id=m.leg_a_account_id,
                leg_a_account_name=account_names.get(m.leg_a_account_id, ""),
                leg_a_date=m.leg_a_date,
                leg_b_id=m.leg_b_id,
                leg_b_account_id=m.leg_b_account_id,
                leg_b_account_name=account_names.get(m.leg_b_account_id, ""),
                leg_b_date=m.leg_b_date,
                amount=m.amount,
                both_categorized_as_transfer=m.both_categorized_as_transfer,
            )
            for m in matches
        ],
        unmatched=[
            UnmatchedTransferLegResponse(
                transaction_id=t.id,
                account_id=t.account_id,
                account_name=account_names.get(t.account_id, ""),
                transaction_date=t.transaction_date,
                narration=t.narration,
                # debit XOR credit, never both - see services/transfer_
                # matching.py's own _signed_amount, which this mirrors
                # rather than imports (a private helper, api/ -> services/
                # is the wrong direction to cross for one).
                amount=t.debit if t.debit is not None else t.credit,
            )
            for t in unmatched
        ],
    )
