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
