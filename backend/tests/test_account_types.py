from datetime import date

from sqlalchemy import text

from app.models import Account, ImportBatch, Transaction

ACCOUNT_PAYLOAD = {
    "name": "Joint Everyday",
    "institution": "ANZ",
    "account_type": "everyday",
    "bsb_number": "013-006",
    "account_number": "5229 8024 5118 3514",
}


# --- validation ---------------------------------------------------------

def test_create_account_rejects_an_unknown_account_type(client):

    response = client.post("/api/accounts", json={**ACCOUNT_PAYLOAD, "account_type": "bogus"})

    assert response.status_code == 422


def test_create_account_allows_a_null_account_type_unclassified(client):

    response = client.post("/api/accounts", json={**ACCOUNT_PAYLOAD, "account_type": None})

    assert response.status_code == 201
    assert response.json()["account_type"] is None


def test_create_account_rejects_an_unknown_balance_sign(client):

    response = client.post("/api/accounts", json={**ACCOUNT_PAYLOAD, "balance_sign": "sideways"})

    assert response.status_code == 422


def test_create_account_defaults_balance_sign_to_natural(client):

    response = client.post("/api/accounts", json=ACCOUNT_PAYLOAD)

    assert response.json()["balance_sign"] == "natural"


def test_update_account_rejects_an_unknown_account_type(client):

    account_id = client.post("/api/accounts", json=ACCOUNT_PAYLOAD).json()["id"]

    response = client.put(
        f"/api/accounts/{account_id}", json={**ACCOUNT_PAYLOAD, "account_type": "bogus"}
    )

    assert response.status_code == 422


def test_update_account_can_set_balance_sign_to_inverted(client):

    account_id = client.post(
        "/api/accounts", json={**ACCOUNT_PAYLOAD, "account_type": "credit_card"}
    ).json()["id"]

    response = client.put(
        f"/api/accounts/{account_id}",
        json={**ACCOUNT_PAYLOAD, "account_type": "credit_card", "balance_sign": "inverted"},
    )

    assert response.status_code == 200
    assert response.json()["balance_sign"] == "inverted"


def test_update_account_omitting_balance_sign_resets_it_to_natural(client):
    """PUT is a full replace, the same as every other field here (omitting
    institution already nulls it) - pinned explicitly because, unlike a
    cosmetic field, silently resetting balance_sign changes a NUMBER
    (whether this account's balance subtracts or adds to net worth). The
    frontend always sends its current value; this is the contract a future
    caller must not accidentally rely on being "sticky".
    """

    account_id = client.post(
        "/api/accounts", json={**ACCOUNT_PAYLOAD, "account_type": "credit_card"}
    ).json()["id"]
    client.put(
        f"/api/accounts/{account_id}",
        json={**ACCOUNT_PAYLOAD, "account_type": "credit_card", "balance_sign": "inverted"},
    )

    response = client.put(
        f"/api/accounts/{account_id}",
        json={**ACCOUNT_PAYLOAD, "account_type": "credit_card"},  # balance_sign omitted
    )

    assert response.status_code == 200
    assert response.json()["balance_sign"] == "natural"


# --- sign inference -------------------------------------------------------

def make_classified_account(db_session, account_type, name="Card", account_number="1111"):

    account = Account(name=name, account_number=account_number, account_type=account_type)
    db_session.add(account)
    db_session.flush()
    return account


def make_balance_snapshot(db_session, account_id, balance, account_number="1111"):
    """A minimal transaction whose only purpose is to leave `balance` in the
    ledger for infer_balance_sign() to read - the debit/narration/date
    values don't matter for that.
    """

    batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
    db_session.add(batch)
    db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        account_id=account_id,
        account_number=account_number,
        transaction_date=date(2026, 7, 1),
        narration="x",
        debit="-5.00",
        balance=balance,
        transaction_type="WDL",
    )
    db_session.add(transaction)
    db_session.flush()


def test_infer_balance_sign_natural_for_a_mostly_negative_liability(client, db_session):

    card = make_classified_account(db_session, "credit_card")
    for balance in ("-100.00", "-50.00", "20.00"):
        make_balance_snapshot(db_session, card.id, balance)
    db_session.commit()

    response = client.get(f"/api/accounts/{card.id}/infer-balance-sign")

    assert response.status_code == 200
    assert response.json() == {"inferred_sign": "natural", "sample_size": 3}


def test_infer_balance_sign_inverted_for_a_mostly_positive_liability(client, db_session):

    card = make_classified_account(db_session, "credit_card")
    for balance in ("100.00", "50.00", "-20.00"):
        make_balance_snapshot(db_session, card.id, balance)
    db_session.commit()

    response = client.get(f"/api/accounts/{card.id}/infer-balance-sign")

    assert response.status_code == 200
    assert response.json() == {"inferred_sign": "inverted", "sample_size": 3}


def test_infer_balance_sign_asset_is_always_natural_with_no_evidence_needed(client, db_session):

    everyday = make_classified_account(db_session, "everyday")
    db_session.commit()

    response = client.get(f"/api/accounts/{everyday.id}/infer-balance-sign")

    assert response.status_code == 200
    assert response.json() == {"inferred_sign": "natural", "sample_size": 0}


def test_infer_balance_sign_unclassified_account_returns_nothing(client, db_session):

    mystery = make_classified_account(db_session, None)
    db_session.commit()

    response = client.get(f"/api/accounts/{mystery.id}/infer-balance-sign")

    assert response.status_code == 200
    assert response.json() == {"inferred_sign": None, "sample_size": 0}


def test_infer_balance_sign_404s_for_a_missing_account(client):

    assert client.get("/api/accounts/999999/infer-balance-sign").status_code == 404


# --- migration data mapping (SQL exercised directly - see the migration
# file itself for the exact statement this mirrors; there is no existing
# precedent in this codebase for running Alembic revisions inside a test,
# see README's Database Migrations section) -------------------------------

def test_migration_sql_maps_known_types_and_nulls_out_the_rest(db_session):

    db_session.add_all([
        Account(name="A", account_number="A1", account_type="Everyday"),
        Account(name="B", account_number="B1", account_type=" SAVINGS "),
        Account(name="C", account_number="C1", account_type="joint account"),
        Account(name="D", account_number="D1", account_type=None),
    ])
    db_session.commit()

    db_session.execute(text(
        """
        UPDATE accounts
        SET account_type = CASE
            WHEN LOWER(TRIM(account_type)) IN
                ('everyday', 'savings', 'investment', 'credit_card', 'loan', 'mortgage')
            THEN LOWER(TRIM(account_type))
            ELSE NULL
        END
        """
    ))
    db_session.commit()

    types = {
        row.account_number: row.account_type
        for row in db_session.execute(text("SELECT account_number, account_type FROM accounts")).all()
    }

    assert types["A1"] == "everyday"
    assert types["B1"] == "savings"
    assert types["C1"] is None
    assert types["D1"] is None
