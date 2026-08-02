"""The Queensland household budget preset - a one-click starting chart of
accounts for a typical Queensland family of four, so a fresh install isn't
spent hand-inventing categories before the app is usable at all.

QLD_HOUSEHOLD_PRESET is pure data: a list of parent groups, each with its
own `kind` and a list of leaf children carrying an indicative monthly
budget (None for income/transfer groups, where a budget doesn't apply).
Parents are grouping only - see models.Category.parent_id's docstring -
so a parent's own budget_amount is always None regardless of what's listed
here; only leaves carry a figure.

These are STARTING figures to edit, not a claim about any particular
household - see the README's Categories section for the full caveat.
Total indicative expense budget is roughly $10,500/month, sized for two
adults and two children (one in paid childcare, one at school - either
leaf is a one-edit removal if it doesn't apply).
"""

from decimal import Decimal

from sqlalchemy.orm import Session

from ..models import Category

QLD_HOUSEHOLD_PRESET = [
    {
        "name": "Housing",
        "kind": "expense",
        "children": [
            ("Mortgage/Rent", Decimal("3000")),
            ("Council Rates", Decimal("400")),
            ("Home & Contents Insurance", Decimal("200")),
            ("Repairs & Maintenance", Decimal("250")),
        ],
    },
    {
        "name": "Utilities",
        "kind": "expense",
        "children": [
            ("Electricity", Decimal("250")),
            ("Water", Decimal("120")),
            ("Internet", Decimal("90")),
            ("Mobile Phones", Decimal("120")),
        ],
    },
    {
        "name": "Food",
        "kind": "expense",
        "children": [
            ("Groceries", Decimal("1600")),
            ("Household Supplies", Decimal("150")),
        ],
    },
    {
        "name": "Transport",
        "kind": "expense",
        "children": [
            ("Fuel", Decimal("350")),
            ("Car Insurance", Decimal("150")),
            ("Registration & Licensing", Decimal("100")),
            ("Servicing & Repairs", Decimal("150")),
            ("Public Transport", Decimal("60")),
        ],
    },
    {
        "name": "Health",
        "kind": "expense",
        "children": [
            ("Private Health Insurance", Decimal("450")),
            ("Medical & Pharmacy", Decimal("120")),
            ("Dental & Optical", Decimal("100")),
        ],
    },
    {
        "name": "Children",
        "kind": "expense",
        "children": [
            ("School Fees & Levies", Decimal("350")),
            ("School Supplies & Uniforms", Decimal("100")),
            ("Activities & Sport", Decimal("250")),
            ("Childcare", Decimal("400")),
        ],
    },
    {
        "name": "Financial",
        "kind": "expense",
        "children": [
            ("Life & Income Protection", Decimal("150")),
            ("Bank Fees & Interest", Decimal("40")),
        ],
    },
    {
        "name": "Lifestyle",
        "kind": "expense",
        "children": [
            ("Dining Out & Takeaway", Decimal("400")),
            ("Entertainment", Decimal("120")),
            ("Subscriptions & Streaming", Decimal("80")),
            ("Clothing", Decimal("200")),
            ("Personal Care", Decimal("120")),
            ("Gifts & Celebrations", Decimal("150")),
            ("Holidays & Travel", Decimal("400")),
            ("Pets", Decimal("120")),
        ],
    },
    {
        "name": "Income",
        "kind": "income",
        "children": [
            ("Salary", None),
            ("Family Tax Benefit", None),
            ("Other Income", None),
        ],
    },
    {
        "name": "Transfers",
        "kind": "transfer",
        "children": [
            ("Credit Card Payment", None),
            ("Savings Transfer", None),
        ],
    },
]


def apply_preset(db: Session) -> tuple[list[str], list[str]]:
    """Creates whatever the preset is missing; never touches an existing
    category. Matching is case-insensitive on name, against the WHOLE
    categories table (not just within one group), so a category the user
    already made under a different group - or with no group at all - is
    left exactly as it is rather than being duplicated or moved.

    Idempotent by construction: running this twice creates nothing the
    second time, since everything the first run created is now itself an
    "already exists" match. Returns (created_names, skipped_names) in
    preset order, for a confirmation message - not full Category objects,
    since the caller (POST /categories/preset) expects the frontend to
    simply refetch /categories afterward rather than trust a partial echo.
    """

    existing_by_name = {
        category.name.lower(): category
        for category in db.query(Category).all()
    }

    created: list[str] = []
    skipped: list[str] = []

    for group in QLD_HOUSEHOLD_PRESET:

        parent = existing_by_name.get(group["name"].lower())

        if parent is None:
            parent = Category(name=group["name"], kind=group["kind"], budget_amount=None)
            db.add(parent)
            db.flush()  # assigns parent.id, needed as children's parent_id below
            existing_by_name[group["name"].lower()] = parent
            created.append(group["name"])
        else:
            skipped.append(group["name"])

        for child_name, child_budget in group["children"]:

            if child_name.lower() in existing_by_name:
                skipped.append(child_name)
                continue

            child = Category(
                name=child_name,
                kind=group["kind"],
                budget_amount=child_budget,
                parent_id=parent.id,
            )
            db.add(child)
            db.flush()
            existing_by_name[child_name.lower()] = child
            created.append(child_name)

    db.commit()

    return created, skipped
