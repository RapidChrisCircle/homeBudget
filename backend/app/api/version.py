from fastapi import APIRouter

from ..schemas import VersionResponse
from ..version import get_commit, get_version

router = APIRouter()


@router.get("/version", response_model=VersionResponse)
def get_version_info():

    return VersionResponse(version=get_version(), commit=get_commit())
