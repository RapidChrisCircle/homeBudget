from datetime import date
from decimal import Decimal

from app.models import Category, CategoryRule, ImportBatch, Transaction
from app.services.categorization import (
    apply_rules_to_existing,
    criteria_match,
    load_rules,
    match_rule,
)


def make_category(db_session, name="Groceries"):

    category = Category(name=name)
    db_session.add(category)
    db_session.flush()
    return category


def make_rule(db_session, category_id, pattern="woolworths", priority=0, **kwargs):

    rule = CategoryRule(
        narration_pattern=pattern,
        category_id=category_id,
        priority=priority,
        **kwargs,
    )
    db_session.add(rule)
    db_session.flush()
    return rule


def make_transaction(db_session, narration="WOOLWORTHS NEWPORT QL", debit="-98.00",
                     credit=None, transaction_type="WDL", category_id=None,
                     categorized_by_rule_id=None):

    batch = db_session.query(ImportBatch).first()

    if batch is None:
        batch = ImportBatch(filename="seed.csv", row_count=0, skipped_duplicate_count=0)
        db_session.add(batch)
        db_session.flush()

    transaction = Transaction(
        import_batch_id=batch.id,
        category_id=category_id,
        categorized_by_rule_id=categorized_by_rule_id,
        bsb_number=None,
        account_number="1111",
        transaction_date=date(2026, 7, 24),
        narration=narration,
        cheque_number=None,
        debit=debit,
        credit=credit,
        balance="100.00",
        transaction_type=transaction_type,
    )
    db_session.add(transaction)
    db_session.flush()
    return transaction


def match(**overrides):

    criteria = {
        "narration_pattern": "woolworths",
        "transaction_type": None,
        "min_amount": None,
        "max_amount": None,
        "narration": "WOOLWORTHS NEWPORT QL",
        "row_transaction_type": "WDL",
        "debit": Decimal("-98.00"),
        "credit": None,
    }
    criteria.update(overrides)
    return criteria_match(**criteria)


def test_rule_matches_narration_case_insensitively():

    assert match(narration_pattern="woolworths", narration="WOOLWORTHS NEWPORT QL")
    assert match(narration_pattern="WOOLWORTHS", narration="Woolworths Online")


def test_rule_does_not_match_when_pattern_absent():

    assert not match(narration_pattern="coles")


def test_blank_pattern_never_matches():

    assert not match(narration_pattern="   ")


def test_rule_with_transaction_type_requires_matching_type():

    assert match(transaction_type="WDL", row_transaction_type="WDL")
    assert match(transaction_type="wdl", row_transaction_type="WDL")
    assert not match(transaction_type="DEP", row_transaction_type="WDL")


def test_amount_range_matches_debit_using_absolute_value():

    # Debits are stored negative; a positive bound must still match.
    assert match(min_amount=Decimal("50"), max_amount=Decimal("150"), debit=Decimal("-98.00"))
    assert not match(min_amount=Decimal("100"), debit=Decimal("-98.00"))


def test_amount_range_matches_credit():

    assert match(
        min_amount=Decimal("100"),
        max_amount=Decimal("5000"),
        debit=None,
        credit=Decimal("3365.49"),
    )


def test_amount_bounds_are_inclusive():

    assert match(min_amount=Decimal("98.00"), max_amount=Decimal("98.00"), debit=Decimal("-98.00"))


def test_row_with_no_amount_fails_any_bounded_rule():

    assert not match(min_amount=Decimal("1"), debit=None, credit=None)


def test_all_criteria_are_anded_together():

    # Narration and amount match, but the type does not.
    assert not match(
        transaction_type="DEP",
        min_amount=Decimal("50"),
        max_amount=Decimal("150"),
        row_transaction_type="WDL",
    )


def test_first_matching_rule_by_priority_wins(db_session):

    groceries = make_category(db_session, "Groceries")
    dining = make_category(db_session, "Dining")

    make_rule(db_session, dining.id, pattern="woolworths", priority=10)
    make_rule(db_session, groceries.id, pattern="woolworths", priority=1)
    db_session.commit()

    winner = match_rule(
        load_rules(db_session),
        narration="WOOLWORTHS NEWPORT QL",
        transaction_type="WDL",
        debit=Decimal("-98.00"),
        credit=None,
    )

    assert winner.category_id == groceries.id


def test_equal_priority_ties_broken_by_lowest_id(db_session):

    groceries = make_category(db_session, "Groceries")
    dining = make_category(db_session, "Dining")

    first = make_rule(db_session, groceries.id, pattern="woolworths", priority=0)
    make_rule(db_session, dining.id, pattern="woolworths", priority=0)
    db_session.commit()

    winner = match_rule(
        load_rules(db_session),
        narration="WOOLWORTHS NEWPORT QL",
        transaction_type="WDL",
        debit=Decimal("-98.00"),
        credit=None,
    )

    assert winner.id == first.id


def test_apply_categorizes_uncategorized_transactions(db_session):

    category = make_category(db_session)
    rule = make_rule(db_session, category.id)
    transaction = make_transaction(db_session)
    db_session.commit()

    assert apply_rules_to_existing(db_session) == 1

    db_session.expire_all()
    updated = db_session.get(Transaction, transaction.id)
    assert updated.category_id == category.id
    assert updated.categorized_by_rule_id == rule.id


def test_apply_returns_zero_when_no_rules_exist(db_session):

    make_transaction(db_session)
    db_session.commit()

    assert apply_rules_to_existing(db_session) == 0


def test_apply_skips_manually_categorized_transactions(db_session):

    groceries = make_category(db_session, "Groceries")
    dining = make_category(db_session, "Dining")
    make_rule(db_session, groceries.id)

    # Manual tag: category set, no rule marker.
    transaction = make_transaction(db_session, category_id=dining.id)
    db_session.commit()

    assert apply_rules_to_existing(db_session) == 0

    db_session.expire_all()
    updated = db_session.get(Transaction, transaction.id)
    assert updated.category_id == dining.id
    assert updated.categorized_by_rule_id is None


def test_apply_recategorizes_rows_previously_set_by_a_rule(db_session):

    groceries = make_category(db_session, "Groceries")
    dining = make_category(db_session, "Dining")

    old_rule = make_rule(db_session, dining.id, pattern="woolworths", priority=0)
    transaction = make_transaction(
        db_session,
        category_id=dining.id,
        categorized_by_rule_id=old_rule.id,
    )
    db_session.commit()

    # The rule is corrected to point at the right category.
    old_rule.category_id = groceries.id
    db_session.commit()

    assert apply_rules_to_existing(db_session) == 1

    db_session.expire_all()
    assert db_session.get(Transaction, transaction.id).category_id == groceries.id


def test_apply_is_idempotent_when_rerun(db_session):

    category = make_category(db_session)
    make_rule(db_session, category.id)
    make_transaction(db_session)
    db_session.commit()

    assert apply_rules_to_existing(db_session) == 1
    assert apply_rules_to_existing(db_session) == 0


def test_apply_respects_priority_order(db_session):

    groceries = make_category(db_session, "Groceries")
    dining = make_category(db_session, "Dining")

    make_rule(db_session, dining.id, pattern="woolworths", priority=5)
    winning = make_rule(db_session, groceries.id, pattern="newport", priority=1)
    transaction = make_transaction(db_session, narration="WOOLWORTHS NEWPORT QL")
    db_session.commit()

    apply_rules_to_existing(db_session)

    db_session.expire_all()
    updated = db_session.get(Transaction, transaction.id)
    assert updated.categorized_by_rule_id == winning.id
    assert updated.category_id == groceries.id
