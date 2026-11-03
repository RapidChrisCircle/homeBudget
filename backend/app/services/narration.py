"""Deriving a merchant identity from a raw bank narration.

Shared by two callers that must never disagree about what counts as "the
same merchant": recurring-payment detection (services/recurring.py) groups
occurrences per-account by narration_key, while ledger transaction grouping
(services/ledger.py) groups uncategorized rows across accounts by the same
key - the same subscription on two cards is two separate recurring
commitments, but it is one merchant for categorization purposes. Living here,
outside both, is what keeps that divergence from becoming an accidental
second definition of "same merchant".
"""


from sqlalchemy.orm import Session

from ..models import MerchantNickname


def narration_key(narration: str) -> str:
    """Groups occurrences of "the same" payment despite bank-side per-row
    noise: fixed-width whitespace padding and varying receipt/reference
    numbers embedded in the narration.
    """

    text = " ".join((narration or "").upper().split())
    words = [w for w in text.split(" ") if not (len(w) >= 4 and w.isdigit())]
    return " ".join(words)


def merchant_label(narration: str) -> str:
    """The human-readable merchant name: the text before the first run of
    2+ spaces (this bank pads narration/location into one fixed-width
    field), or the whole trimmed narration when there is no such run.
    """

    text = (narration or "").strip()
    head = text.split("  ")[0]
    return " ".join(head.split())


def merchant_nicknames_map(db: Session) -> dict[str, str]:
    """{narration_key: nickname} for all configured merchant nicknames."""

    return {
        row.narration_key: row.nickname
        for row in db.query(MerchantNickname).all()
    }


def resolve_merchant_nickname(narration: str, nicknames_map: dict[str, str]) -> str | None:
    """Resolves the display nickname for a transaction narration or narration_key.

    Checks exact `narration_key`, exact `merchant_label` key, and longest
    configured pattern key matching as a substring of `narration_key(narration)`.
    """

    if not nicknames_map or not narration:
        return None

    full_key = narration_key(narration)
    if full_key in nicknames_map:
        return nicknames_map[full_key]

    label_key = narration_key(merchant_label(narration))
    if label_key and label_key in nicknames_map:
        return nicknames_map[label_key]

    for pattern_key in sorted(nicknames_map.keys(), key=len, reverse=True):
        if pattern_key and pattern_key in full_key:
            return nicknames_map[pattern_key]

    return None


def upsert_merchant_nickname(
    db: Session,
    raw_key_or_narration: str,
    nickname: str | None,
) -> tuple[str, str | None]:
    """Upserts or removes (when `nickname` is blank/None) a MerchantNickname
    keyed by `narration_key(raw_key_or_narration)`. Does not commit so callers
    can include it in their own transaction.
    """

    key = narration_key(raw_key_or_narration) or (raw_key_or_narration or "").strip().upper()
    if not key:
        return "", None

    clean_nickname = (nickname or "").strip()
    existing = db.query(MerchantNickname).filter(MerchantNickname.narration_key == key).first()

    if not clean_nickname:
        if existing is not None:
            db.delete(existing)
        return key, None

    if existing is not None:
        existing.nickname = clean_nickname
    else:
        db.add(MerchantNickname(narration_key=key, nickname=clean_nickname))

    return key, clean_nickname
