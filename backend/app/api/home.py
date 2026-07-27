from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import HomeStatus
from ..schemas import HomeStatusResponse

router = APIRouter()


def get_db():

    db = SessionLocal()

    try:
        yield db

    finally:
        db.close()


@router.get("/status", response_model=HomeStatusResponse)
def get_status(
    db: Session = Depends(get_db)
):

    status = db.query(HomeStatus).first()

    if status is None:

        raise HTTPException(
            status_code=404,
            detail="No status row found. Create one record in home_status to verify DB reads."
        )

    return status
