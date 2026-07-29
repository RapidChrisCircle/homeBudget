import csv
import io
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy.orm import Session

from ..models import ImportBatch, Transaction

EXPECTED_HEADERS = [
    "BSB Number",
    "Account Number",
    "Transaction Date",
    "Narration",
    "Cheque Number",
    "Debit",
    "Credit",
    "Balance",
    "Transaction Type",
]


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

    def __init__(self, errors: list[tuple[int, str]]):

        super().__init__("CSV validation failed")
        self.errors = errors


def _blank(value: str | None) -> bool:

    return value is None or value.strip() == ""


def _parse_decimal(value: str, field_name: str, row_number: int, errors: list[tuple[int, str]]) -> Decimal | None:

    cleaned = value.strip().replace(",", "")

    try:
        return Decimal(cleaned)

    except InvalidOperation:
        errors.append((row_number, f"invalid {field_name} amount '{value}'"))
        return None


def parse_and_validate(file_bytes: bytes) -> list[ParsedRow]:

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

    if header != EXPECTED_HEADERS:
        raise CsvValidationError([
            (1, f"unexpected header row, expected columns: {', '.join(EXPECTED_HEADERS)}")
        ])

    errors: list[tuple[int, str]] = []
    rows: list[ParsedRow] = []
    last_row_number = 1

    try:
        for row_number, raw_row in enumerate(reader, start=2):

            last_row_number = row_number

            if all(_blank(value) for value in raw_row):
                continue

            if len(raw_row) != len(EXPECTED_HEADERS):
                errors.append((row_number, f"expected {len(EXPECTED_HEADERS)} columns, found {len(raw_row)}"))
                continue

            if raw_row == EXPECTED_HEADERS:
                errors.append((row_number, "row appears to be a repeated header row"))
                continue

            (
                bsb_raw, account_raw, date_raw, narration_raw, cheque_raw,
                debit_raw, credit_raw, balance_raw, type_raw
            ) = raw_row

            errors_before = len(errors)

            account_number = account_raw.strip()
            if _blank(account_number):
                errors.append((row_number, "Account Number is required"))

            bsb_number = None if _blank(bsb_raw) else bsb_raw.strip()

            transaction_date = None
            try:
                transaction_date = datetime.strptime(date_raw.strip(), "%d/%m/%Y").date()

            except ValueError:
                errors.append((row_number, f"invalid Transaction Date '{date_raw}', expected DD/MM/YYYY"))

            narration = narration_raw.strip()
            if _blank(narration):
                errors.append((row_number, "Narration is required"))

            cheque_number = None if _blank(cheque_raw) else cheque_raw.strip()

            debit_present = not _blank(debit_raw)
            credit_present = not _blank(credit_raw)

            debit = _parse_decimal(debit_raw, "Debit", row_number, errors) if debit_present else None
            credit = _parse_decimal(credit_raw, "Credit", row_number, errors) if credit_present else None

            if debit_present and credit_present:
                errors.append((row_number, "row has both Debit and Credit populated"))
            elif not debit_present and not credit_present:
                errors.append((row_number, "row has neither Debit nor Credit populated"))

            balance = None
            if _blank(balance_raw):
                errors.append((row_number, "Balance is required"))
            else:
                balance = _parse_decimal(balance_raw, "Balance", row_number, errors)

            transaction_type = type_raw.strip()
            if _blank(transaction_type):
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
        raise CsvValidationError([
            (last_row_number + 1, f"malformed CSV data near this row: {exc}")
        ]) from None

    if errors:
        raise CsvValidationError(errors)

    if not rows:
        raise CsvValidationError([(2, "CSV has no data rows to import")])

    return rows


def import_rows(db: Session, filename: str, rows: list[ParsedRow]) -> ImportBatch:

    account_numbers = {row.account_number for row in rows}

    existing_keys = {
        (t.bsb_number, t.account_number, t.transaction_date, t.narration, t.debit, t.credit, t.balance)
        for t in db.query(Transaction).filter(Transaction.account_number.in_(account_numbers)).all()
    }

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

        db.add(Transaction(
            import_batch_id=batch.id,
            bsb_number=row.bsb_number,
            account_number=row.account_number,
            transaction_date=row.transaction_date,
            narration=row.narration,
            cheque_number=row.cheque_number,
            debit=row.debit,
            credit=row.credit,
            balance=row.balance,
            transaction_type=row.transaction_type,
        ))
        inserted += 1

    batch.row_count = inserted
    batch.skipped_duplicate_count = skipped

    db.commit()
    db.refresh(batch)

    return batch
