"""Bank CSV layouts - both the one built in (ANZ) and any user-saved mapping
(models.CsvFormatMapping) for another bank's export - reduced to the SAME
ColumnMapping shape before parsing, so services/csv_import.py has exactly
one parsing code path regardless of which kind matched a given upload.

A layout is identified purely by its header row, joined with a separator
that cannot appear in a real header cell (header_signature below) and
matched by EXACT equality - not fuzzy, not by column count alone. Two
banks that happen to use the same column count and semantic order but
different header labels are two different signatures, which is correct:
a labelled mismatch (importing "Value Date" data into what the app thinks
is "Transaction Date") is exactly the class of silent error a signature
match exists to prevent.

Column order and count are NOT required to be the fixed ANZ layout for a
mapped format - that is the whole point of the mapping mechanism. What IS
still required, for every format including saved mappings, is a Balance
column: this app's most load-bearing invariant is that Transaction.balance
is the bank's own running balance, never derived by summing debits/credits
(see services/ledger.py's module docstring). A format with no balance
column is out of scope and is rejected explicitly (ColumnMapping.balance_index
is never Optional, and CsvColumnMappingInput in schemas.py makes the same
field required) rather than silently deriving one.
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from ..models import CsvFormatMapping

AMOUNT_MODES = ("debit_credit", "single_amount")


def validate_mapping_input(payload) -> str | None:
    """Shared by api/csv_formats.py (before saving) and api/transactions.py
    (before previewing) - the same shape check either way, so a mapping
    that passes preview can never turn out to be rejected only once saving
    is attempted. Returns an error message, or None when the payload is
    internally consistent (this does NOT check the indices against any
    actual file - services.csv_import._parse_rows does that once a real
    header is available).
    """

    if payload.amount_mode not in AMOUNT_MODES:
        return f"amount_mode must be one of: {', '.join(AMOUNT_MODES)}"

    if payload.amount_mode == "debit_credit":
        if payload.debit_index is None or payload.credit_index is None:
            return "debit_credit mode requires both a Debit column and a Credit column"
    else:
        if payload.amount_index is None:
            return "single_amount mode requires an Amount column"

    return None

# A control character, not a printable one - guaranteed not to appear in a
# real bank's header cell text, so joining with it can never produce a
# signature collision between two genuinely different header rows.
HEADER_SEPARATOR = "\x1f"


def header_signature(header: list[str]) -> str:
    """The one place a header row becomes a signature - both matching a
    saved mapping and saving a new one go through this, so the two can
    never compute it differently and silently fail to find each other.
    """

    return HEADER_SEPARATOR.join(header)


@dataclass
class ColumnMapping:
    """The one shape services/csv_import.py's parser works against,
    regardless of whether it came from the built-in ANZ format or a saved
    CsvFormatMapping row. See module docstring for amount_mode and why
    balance_index is never Optional.
    """

    institution: str | None
    date_format: str
    amount_mode: str
    bsb_index: int | None
    account_number_index: int
    transaction_date_index: int
    narration_index: int
    cheque_number_index: int | None
    debit_index: int | None
    credit_index: int | None
    amount_index: int | None
    balance_index: int
    transaction_type_index: int | None


ANZ_HEADER = [
    "BSB Number", "Account Number", "Transaction Date", "Narration",
    "Cheque Number", "Debit", "Credit", "Balance", "Transaction Type",
]

_ANZ_MAPPING = ColumnMapping(
    institution="ANZ",
    date_format="%d/%m/%Y",
    amount_mode="debit_credit",
    bsb_index=0,
    account_number_index=1,
    transaction_date_index=2,
    narration_index=3,
    cheque_number_index=4,
    debit_index=5,
    credit_index=6,
    amount_index=None,
    balance_index=7,
    transaction_type_index=8,
)

# {header_signature: ColumnMapping} - a dict, not a list scanned with an
# equality loop, since built-in formats are now matched the identical way
# saved mappings are (a signature lookup). Kept as a plain module-level dict
# (mutated directly by a couple of backend tests that add a second
# built-in-shaped format) to prove auto-detection isn't hardcoded to ANZ
# specifically.
BUILTIN_FORMATS: dict[str, ColumnMapping] = {
    header_signature(ANZ_HEADER): _ANZ_MAPPING,
}


def _mapping_from_row(saved: CsvFormatMapping) -> ColumnMapping:

    return ColumnMapping(
        institution=saved.institution,
        date_format=saved.date_format,
        amount_mode=saved.amount_mode,
        bsb_index=saved.bsb_index,
        account_number_index=saved.account_number_index,
        transaction_date_index=saved.transaction_date_index,
        narration_index=saved.narration_index,
        cheque_number_index=saved.cheque_number_index,
        debit_index=saved.debit_index,
        credit_index=saved.credit_index,
        amount_index=saved.amount_index,
        balance_index=saved.balance_index,
        transaction_type_index=saved.transaction_type_index,
    )


def find_format_for_header(db: Session, header: list[str]) -> ColumnMapping | None:
    """Matches a header row against the built-in format(s) first, then any
    saved mapping - both by EXACT header-signature equality. None means
    neither matched, which is the signal to fall into the mapping/preview
    flow (see api/transactions.py's import endpoint) instead of a flat
    rejection.
    """

    signature = header_signature(header)

    if signature in BUILTIN_FORMATS:
        return BUILTIN_FORMATS[signature]

    saved = (
        db.query(CsvFormatMapping)
        .filter(CsvFormatMapping.header_signature == signature)
        .first()
    )

    if saved is None:
        return None

    return _mapping_from_row(saved)
