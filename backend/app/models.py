from sqlalchemy import Column, Integer, String

from .database import Base


class HomeStatus(Base):

    __tablename__ = "home_status"

    id = Column(
        Integer,
        primary_key=True
    )

    message = Column(
        String,
        default="Home system online"
    )
