from pydantic import BaseModel


class HomeStatusResponse(BaseModel):

    id: int
    message: str

    class Config:
        from_attributes = True
