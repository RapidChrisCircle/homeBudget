from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..deps import get_db
from ..schemas import NetWorthResponse
from ..services.net_worth import net_worth_now

router = APIRouter()


@router.get("/net-worth", response_model=NetWorthResponse)
def get_net_worth(db: Session = Depends(get_db)):
    """The only place a Dashboard-facing "how much am I worth" figure is
    computed - see services/net_worth.py's own module docstring for why
    this replaced a client-side straight sum that couldn't tell an asset
    from a liability.
    """

    return NetWorthResponse(**net_worth_now(db))
