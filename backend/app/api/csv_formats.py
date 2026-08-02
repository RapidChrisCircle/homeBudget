"""Saved CSV column mappings - see services/csv_formats.py for how these
combine with the built-in ANZ format at import time, and models.py's
CsvFormatMapping for the full field-by-field reasoning.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import CsvFormatMapping
from ..schemas import CsvFormatMappingCreate, CsvFormatMappingResponse
from ..services.csv_formats import header_signature, validate_mapping_input

router = APIRouter()


@router.get("/csv-formats", response_model=list[CsvFormatMappingResponse])
def list_csv_formats(db: Session = Depends(get_db)):

    return (
        db.query(CsvFormatMapping)
        .order_by(CsvFormatMapping.name)
        .all()
    )


@router.post("/csv-formats", response_model=CsvFormatMappingResponse, status_code=201)
def create_csv_format(
    payload: CsvFormatMappingCreate,
    db: Session = Depends(get_db)
):
    """Saves a column mapping so the NEXT upload of the same header
    auto-detects it - see services/csv_formats.find_format_for_header,
    which api/transactions.py's import endpoint always routes through
    regardless of whether a format is built in or saved here. This
    endpoint never imports anything itself.
    """

    error = validate_mapping_input(payload.mapping)
    if error:
        raise HTTPException(status_code=422, detail=error)

    signature = header_signature(payload.header)

    # Upsert by header_signature - re-saving a mapping for the same header
    # (the user correcting an earlier mistake) replaces it in place rather
    # than colliding with the unique constraint.
    mapping_row = (
        db.query(CsvFormatMapping)
        .filter(CsvFormatMapping.header_signature == signature)
        .first()
    )

    if mapping_row is None:
        mapping_row = CsvFormatMapping(header_signature=signature)
        db.add(mapping_row)

    for field, value in payload.mapping.model_dump().items():
        setattr(mapping_row, field, value)

    db.commit()
    db.refresh(mapping_row)

    return mapping_row


@router.delete("/csv-formats/{mapping_id}", status_code=204)
def delete_csv_format(
    mapping_id: int,
    db: Session = Depends(get_db)
):

    mapping_row = db.get(CsvFormatMapping, mapping_id)

    if mapping_row is None:
        raise HTTPException(status_code=404, detail="CSV format mapping not found")

    db.delete(mapping_row)
    db.commit()
