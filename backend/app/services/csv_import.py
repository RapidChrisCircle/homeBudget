"""CSV parsing, validation and import.

Column-mapping driven (see services/csv_formats.py) rather than assuming a
single fixed 9-column ANZ layout - parse_and_validate() and preview_import()
both work against services.csv_formats.ColumnMapping, regardless of whether
it came from the built-in ANZ format or a saved CsvFormatMapping row, so
there is exactly one row-parsing code path (_parse_rows below) for every
bank layout the app knows about.
"""

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy.orm import Session

from ..models import Account, ImportBatch, Transaction
from .categorization import apply_rules_to_transaction, load_rules
from .csv_formats import ColumnMapping, find_format_for_header

# Preview shows a HANDFUL of parsed rows, not the whole file - enough to
# confirm a candidate mapping looks right, not a second import.
PREVIEW_SAMPLE_ROWS = 5


@dataclass
class ParsedRow:

    bsb_number: str | None
    account_number: str
    transaction_date: date
    narration: str
    cheque_number: str | None
    debit: Decimal | None
    credit: Decimal | None
    balance: Decimal
    transaction_type: str


class CsvValidationError(Exception):
    """Row-level problems in an otherwise-recognized format - a bad date, a
    missing amount, wrong column count. Import is all-or-nothing: any of
    these means nothing in the file gets written.
    """

    def __init__(self, errors: list[tuple[int, str]]):

        super().__init__("CSV validation failed")
        self.errors = errors


class UnrecognizedFormatError(Exception):
    """The header didn't match ANY known format - built-in or saved. This is
    NOT "this file is broken", it is "the app doesn't know this file's
    layout yet" - a different problem needing a different response (the
    mapping UI), which is why it is not just another CsvValidationError.
    Carries what that UI needs to build itself: the raw header and a few
    raw sample rows, straight from the file, before any mapping is applied.
    """

    def __init__(self, header: list[str], sample_rows: list[list[str]]):

        super().__init__("unrecognized CSV header")
        self.header = header
        self.sample_rows = sample_rows


def _blank(value: str | None) -> bool:

    return value is None or value.strip() == ""


def _parse_decimal(value: str, field_name: str, row_number: int, errors: list[tuple[int, str]]) -> Decimal | None:

    cleaned = value.strip().replace(",", "")

    try:
        return Decimal(cleaned)

    except InvalidOperation:
        errors.append((row_number, f"invalid {field_name} amount '{value}'"))
        return None


def _read_header_and_rows(file_bytes: bytes):
    """Shared by parse_and_validate and preview_import - decodes the file,
    reads off the header row, and returns (header, reader) with the reader
    positioned at the first data row. Raises CsvValidationError for a file
    that is malformed before any per-row parsing could even start.
    """

    try:
        text = file_bytes.decode("utf-8-sig")

    except UnicodeDecodeError:
        raise CsvValidationError([
            (1, "file is not valid UTF-8 text - please save/export the CSV as UTF-8")
        ]) from None

    reader = csv.reader(io.StringIO(text))

    try:
        header = next(reader)

    except StopIteration:
        raise CsvValidationError([(1, "file is empty, expected a header row")]) from None

    except csv.Error as exc:
        raise CsvValidationError([(1, f"could not parse CSV header: {exc}")]) from None

    return header, reader


def _parse_rows(mapping: ColumnMapping, header: list[str], reader, *, stop_after: int | None = None):
    """The generalized row-parsing loop - reads columns by mapping.*_index
    instead of a fixed positional order, so the same code serves the
    built-in ANZ layout and any saved mapping alike.

    Returns (rows, errors) and never raises for row-level problems, so
    preview_import can show partial results alongside errors instead of an
    all-or-nothing rejection; parse_and_validate (the real import path) is
    what turns a non-empty errors list into a raised CsvValidationError,
    since import ITSELF is still all-or-nothing.

    stop_after limits how many DATA rows are COLLECTED - once that many
    valid rows exist, the loop stops scanning the rest of the file
    entirely (preview_import only ever needs a handful, and must not pay
    the cost of parsing a 10,000-row file just to show 5). This means a
    row-level problem after the stop point goes unseen by a preview - an
    accepted tradeoff, since preview's job is "does this mapping look
    right", not a full validation pass; parse_and_validate (no stop_after)
    is what scans the whole file for the real import.
    """

    column_count = len(header)

    mapped_indices = [
        i for i in (
            mapping.bsb_index, mapping.account_number_index, mapping.transaction_date_index,
            mapping.narration_index, mapping.cheque_number_index, mapping.debit_index,
            mapping.credit_index, mapping.amount_index, mapping.balance_index,
            mapping.transaction_type_index,
        )
        if i is not None
    ]

    if any(i >= column_count or i < 0 for i in mapped_indices):
        return [], [(1, f"mapping references a column beyond this file's {column_count} columns")]

    def cell(raw_row: list[str], index: int | None) -> str:
        return raw_row[index] if index is not None else ""

    errors: list[tuple[int, str]] = []
    rows: list[ParsedRow] = []
    last_row_number = 1

    try:
        for row_number, raw_row in enumerate(reader, start=2):

            last_row_number = row_number

            if stop_after is not None and len(rows) >= stop_after:
                break

            if all(_blank(value) for value in raw_row):
                continue

            if len(raw_row) != column_count:
                errors.append((row_number, f"expected {column_count} columns, found {len(raw_row)}"))
                continue

            if raw_row == header:
                errors.append((row_number, "row appears to be a repeated header row"))
                continue

            errors_before = len(errors)

            account_number = cell(raw_row, mapping.account_number_index).strip()
            if _blank(account_number):
                errors.append((row_number, "Account Number is required"))

            bsb_raw = cell(raw_row, mapping.bsb_index)
            bsb_number = None if _blank(bsb_raw) else bsb_raw.strip()

            date_raw = cell(raw_row, mapping.transaction_date_index)
            transaction_date = None
            try:
                transaction_date = datetime.strptime(date_raw.strip(), mapping.date_format).date()

            except ValueError:
                errors.append((row_number, f"invalid Transaction Date '{date_raw}', expected format {mapping.date_format}"))

            narration = cell(raw_row, mapping.narration_index).strip()
            if _blank(narration):
                errors.append((row_number, "Narration is required"))

            cheque_raw = cell(raw_row, mapping.cheque_number_index)
            cheque_number = None if _blank(cheque_raw) else cheque_raw.strip()

            debit: Decimal | None = None
            credit: Decimal | None = None

            if mapping.amount_mode == "single_amount":

                amount_raw = cell(raw_row, mapping.amount_index)

                if _blank(amount_raw):
                    errors.append((row_number, "Amount is required"))
                else:
                    amount = _parse_decimal(amount_raw, "Amount", row_number, errors)
                    if amount is not None:
                        # Splits by sign into the same storage convention
                        # every other format uses - negative -> debit,
                        # positive (including exactly zero) -> credit - so
                        # nothing downstream of import ever learns
                        # single-amount files exist.
                        if amount < 0:
                            debit = amount
                        else:
                            credit = amount

            else:
                debit_raw = cell(raw_row, mapping.debit_index)
                credit_raw = cell(raw_row, mapping.credit_index)
                debit_present = not _blank(debit_raw)
                credit_present = not _blank(credit_raw)

                debit = _parse_decimal(debit_raw, "Debit", row_number, errors) if debit_present else None
                credit = _parse_decimal(credit_raw, "Credit", row_number, errors) if credit_present else None

                if debit_present and credit_present:
                    errors.append((row_number, "row has both Debit and Credit populated"))
                elif not debit_present and not credit_present:
                    errors.append((row_number, "row has neither Debit nor Credit populated"))

            balance_raw = cell(raw_row, mapping.balance_index)
            balance = None
            if _blank(balance_raw):
                errors.append((row_number, "Balance is required"))
            else:
                balance = _parse_decimal(balance_raw, "Balance", row_number, errors)

            # Optional column - a bank export with no explicit type column
            # (just date/description/amount/balance) still imports; the
            # stored value is just an empty string, never None
            # (Transaction.transaction_type is NOT NULL).
            transaction_type = cell(raw_row, mapping.transaction_type_index).strip()
            if mapping.transaction_type_index is not None and _blank(transaction_type):
                errors.append((row_number, "Transaction Type is required"))

            if len(errors) > errors_before:
                continue

            rows.append(ParsedRow(
                bsb_number=bsb_number,
                account_number=account_number,
                transaction_date=transaction_date,
                narration=narration,
                cheque_number=cheque_number,
                debit=debit,
                credit=credit,
                balance=balance,
                transaction_type=transaction_type,
            ))

    except csv.Error as exc:
        errors.append((last_row_number + 1, f"malformed CSV data near this row: {exc}"))

    return rows, errors


def parse_and_validate(db: Session, file_bytes: bytes) -> tuple[ColumnMapping, list[ParsedRow]]:
    """The real import path. Auto-detects the format from the header
    (built-in or saved - see services.csv_formats.find_format_for_header)
    and requires the WHOLE file to be valid, raising CsvValidationError
    otherwise - import has always been all-or-nothing, mapping support
    doesn't change that.

    Raises UnrecognizedFormatError (not CsvValidationError) when the header
    matches nothing at all - the caller (api/transactions.py) turns that
    into a distinct "needs mapping" response rather than a flat rejection.
    """

    header, reader = _read_header_and_rows(file_bytes)

    mapping = find_format_for_header(db, header)

    if mapping is None:

        sample_rows = []
        for raw_row in reader:
            if len(sample_rows) >= PREVIEW_SAMPLE_ROWS:
                break
            if any(not _blank(value) for value in raw_row):
                sample_rows.append(raw_row)

        raise UnrecognizedFormatError(header, sample_rows)

    rows, errors = _parse_rows(mapping, header, reader)

    if errors:
        raise CsvValidationError(errors)

    if not rows:
        raise CsvValidationError([(2, "CSV has no data rows to import")])

    return mapping, rows


def preview_import(
    db: Session, file_bytes: bytes, mapping: ColumnMapping
) -> tuple[list[ParsedRow], list[tuple[int, str]]]:
    """Parses with an EXPLICIT candidate mapping, bypassing auto-detection
    entirely - the caller is deliberately testing a mapping that may not be
    saved, or even valid, yet. Limited to PREVIEW_SAMPLE_ROWS and never
    raises for row-level problems; the whole point is to show what's wrong
    (or right) without an all-or-nothing rejection. Writes nothing
    regardless of outcome - there is no import_rows call anywhere in this
    function, deliberately.

    `db` is accepted for signature symmetry with parse_and_validate even
    though it's unused here (an explicit mapping never needs a database
    lookup) - kept so both entry points have the same shape from the API
    layer's point of view.
    """

    header, reader = _read_header_and_rows(file_bytes)
    return _parse_rows(mapping, header, reader, stop_after=PREVIEW_SAMPLE_ROWS)


def import_rows(
    db: Session,
    filename: str,
    mapping: ColumnMapping,
    rows: list[ParsedRow]
) -> tuple[ImportBatch, int, int]:

    account_numbers = {row.account_number for row in rows}

    existing_keys = {
        (t.bsb_number, t.account_number, t.transaction_date, t.narration, t.debit, t.credit, t.balance)
        for t in db.query(Transaction).filter(Transaction.account_number.in_(account_numbers)).all()
    }

    existing_accounts = {
        a.account_number: a
        for a in db.query(Account).filter(Account.account_number.in_(account_numbers)).all()
    }

    # Loaded once for the whole file - matching is then pure Python per row.
    rules = load_rules(db)

    new_account_count = 0
    auto_categorized_count = 0

    batch = ImportBatch(filename=filename, row_count=0, skipped_duplicate_count=0)
    db.add(batch)
    db.flush()

    seen_in_file = set()
    inserted = 0
    skipped = 0

    for row in rows:

        key = (
            row.bsb_number, row.account_number, row.transaction_date,
            row.narration, row.debit, row.credit, row.balance
        )

        if key in existing_keys or key in seen_in_file:
            skipped += 1
            continue

        seen_in_file.add(key)

        account = existing_accounts.get(row.account_number)

        if account is None:
            account = Account(
                name=row.account_number,
                institution=mapping.institution,
                bsb_number=row.bsb_number,
                account_number=row.account_number,
            )
            db.add(account)
            db.flush()
            existing_accounts[row.account_number] = account
            new_account_count += 1

        transaction = Transaction(
            import_batch_id=batch.id,
            account_id=account.id,
            bsb_number=row.bsb_number,
            account_number=row.account_number,
            transaction_date=row.transaction_date,
            narration=row.narration,
            cheque_number=row.cheque_number,
            debit=row.debit,
            credit=row.credit,
            balance=row.balance,
            transaction_type=row.transaction_type,
        )

        if apply_rules_to_transaction(rules, transaction):
            auto_categorized_count += 1

        db.add(transaction)
        inserted += 1

    batch.row_count = inserted
    batch.skipped_duplicate_count = skipped

    db.commit()
    db.refresh(batch)

    return batch, new_account_count, auto_categorized_count
