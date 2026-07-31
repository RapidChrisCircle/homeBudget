from dataclasses import dataclass


@dataclass
class CsvFormat:
    """A supported bank CSV layout.

    expected_headers must have exactly 9 columns in this fixed logical
    order: BSB, Account Number, Transaction Date, Narration, Cheque Number,
    Debit, Credit, Balance, Transaction Type. Different banks can use
    different header labels and date formats, but not a different column
    order or count - that would need a full column-mapping mechanism,
    which is out of scope for now.
    """

    key: str
    institution: str
    expected_headers: list[str]
    date_format: str


CSV_FORMATS: list[CsvFormat] = [
    CsvFormat(
        key="anz_default",
        institution="ANZ",
        expected_headers=[
            "BSB Number",
            "Account Number",
            "Transaction Date",
            "Narration",
            "Cheque Number",
            "Debit",
            "Credit",
            "Balance",
            "Transaction Type",
        ],
        date_format="%d/%m/%Y",
    ),
]


def find_format_for_header(header: list[str]) -> CsvFormat | None:

    for csv_format in CSV_FORMATS:
        if header == csv_format.expected_headers:
            return csv_format

    return None
