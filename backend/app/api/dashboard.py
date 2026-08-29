"""The customisable Dashboard's own layout - which widgets, in what order,
how wide, with which options. Mirrors api/category_rules.py's CRUD+move
shape deliberately: both are ordered lists a user reorders in place, so
list/create/update/delete/move behave identically whichever one you're
looking at. See models.DashboardWidget's own docstring for what this table
does and does not store.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..deps import get_db
from ..models import DASHBOARD_WIDGET_TYPES, DASHBOARD_WIDGET_WIDTHS, DashboardWidget
from ..schemas import (
    DashboardWidgetCreate,
    DashboardWidgetMove,
    DashboardWidgetResponse,
    DashboardWidgetUpdate,
)

router = APIRouter()


def _validate_width(width: str) -> None:

    if width not in DASHBOARD_WIDGET_WIDTHS:
        raise HTTPException(status_code=422, detail=f"width must be one of: {', '.join(DASHBOARD_WIDGET_WIDTHS)}")


def _list_widgets(db: Session) -> list[DashboardWidget]:

    return (
        db.query(DashboardWidget)
        .order_by(DashboardWidget.position, DashboardWidget.id)
        .all()
    )


@router.get("/dashboard/widgets", response_model=list[DashboardWidgetResponse])
def list_dashboard_widgets(db: Session = Depends(get_db)):

    return _list_widgets(db)


@router.post("/dashboard/widgets", response_model=DashboardWidgetResponse, status_code=201)
def create_dashboard_widget(
    payload: DashboardWidgetCreate,
    db: Session = Depends(get_db)
):

    if payload.widget_type not in DASHBOARD_WIDGET_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"widget_type must be one of: {', '.join(DASHBOARD_WIDGET_TYPES)}",
        )

    _validate_width(payload.width)

    # New widgets go to the bottom, same as a new CategoryRule going to the
    # end of the evaluation order.
    next_position = (db.query(func.max(DashboardWidget.position)).scalar() or 0) + 1

    widget = DashboardWidget(**payload.model_dump(), position=next_position)
    db.add(widget)
    db.commit()
    db.refresh(widget)

    return widget


@router.put("/dashboard/widgets/{widget_id}", response_model=DashboardWidgetResponse)
def update_dashboard_widget(
    widget_id: int,
    payload: DashboardWidgetUpdate,
    db: Session = Depends(get_db)
):

    widget = db.get(DashboardWidget, widget_id)

    if widget is None:
        raise HTTPException(status_code=404, detail="Widget not found")

    _validate_width(payload.width)

    widget.width = payload.width
    widget.config = payload.config

    db.commit()
    db.refresh(widget)

    return widget


@router.post("/dashboard/widgets/{widget_id}/move", response_model=list[DashboardWidgetResponse])
def move_dashboard_widget(
    widget_id: int,
    payload: DashboardWidgetMove,
    db: Session = Depends(get_db)
):

    if payload.direction not in ("up", "down"):
        raise HTTPException(status_code=422, detail="direction must be 'up' or 'down'")

    widgets = _list_widgets(db)
    index = next((i for i, widget in enumerate(widgets) if widget.id == widget_id), None)

    if index is None:
        raise HTTPException(status_code=404, detail="Widget not found")

    swap_with = index - 1 if payload.direction == "up" else index + 1

    if 0 <= swap_with < len(widgets):
        current, neighbour = widgets[index], widgets[swap_with]
        current.position, neighbour.position = neighbour.position, current.position
        db.commit()

    return _list_widgets(db)


@router.delete("/dashboard/widgets/{widget_id}", status_code=204)
def delete_dashboard_widget(widget_id: int, db: Session = Depends(get_db)):

    widget = db.get(DashboardWidget, widget_id)

    if widget is None:
        raise HTTPException(status_code=404, detail="Widget not found")

    db.delete(widget)
    db.commit()
