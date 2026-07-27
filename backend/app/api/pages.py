from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..models import HomeStatus
from .home import get_db

router = APIRouter(prefix="/pages", tags=["verification-pages"])


@router.get("/no-db", response_class=HTMLResponse)
def no_db_page(request: Request):

    html = f"""
    <html>
      <head>
        <title>FastAPI No-DB Verification</title>
        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
        <style>
          body {{ font-family: Arial, sans-serif; margin: 2rem; line-height: 1.5; }}
          .card {{ max-width: 760px; padding: 1rem 1.25rem; border: 1px solid #ddd; border-radius: 10px; }}
          .ok {{ color: #096a2e; }}
          code {{ background: #f4f4f4; padding: 0.15rem 0.3rem; border-radius: 4px; }}
          a {{ color: #0057a8; }}
        </style>
      </head>
      <body>
        <h1>FastAPI No-DB Verification</h1>
        <div class=\"card\">
          <p class=\"ok\"><strong>OK:</strong> This page renders without performing any database query.</p>
          <p>Path: <code>{request.url.path}</code></p>
          <p>API Root: <a href=\"/\">/</a></p>
          <p>DB Verification Page: <a href=\"/pages/db-status\">/pages/db-status</a></p>
        </div>
      </body>
    </html>
    """

    return HTMLResponse(content=html)


@router.get("/db-status", response_class=HTMLResponse)
def db_status_page(db: Session = Depends(get_db)):

    try:

        status = db.query(HomeStatus).first()

        if status is None:
            body = """
            <p><strong>No data found:</strong> Database connection worked, but table has no rows.</p>
            <p>Insert one record in <code>home_status</code> to complete this verification.</p>
            """
        else:
            body = f"""
            <p><strong>DB read successful.</strong></p>
            <ul>
              <li>ID: {status.id}</li>
              <li>Message: {status.message}</li>
            </ul>
            """

    except SQLAlchemyError as exc:
        body = f"""
        <p><strong>DB read failed:</strong> {exc}</p>
        <p>Check database settings and connectivity.</p>
        """

    html = f"""
    <html>
      <head>
        <title>FastAPI DB Verification</title>
        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
        <style>
          body {{ font-family: Arial, sans-serif; margin: 2rem; line-height: 1.5; }}
          .card {{ max-width: 760px; padding: 1rem 1.25rem; border: 1px solid #ddd; border-radius: 10px; }}
          code {{ background: #f4f4f4; padding: 0.15rem 0.3rem; border-radius: 4px; }}
          a {{ color: #0057a8; }}
        </style>
      </head>
      <body>
        <h1>FastAPI DB Verification</h1>
        <div class=\"card\">{body}</div>
        <p><a href=\"/pages/no-db\">Back to no-DB page</a></p>
      </body>
    </html>
    """

    return HTMLResponse(content=html)
