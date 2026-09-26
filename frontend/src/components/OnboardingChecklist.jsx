import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from './Card.jsx'
import { api } from '../services/api'

// Guided first-run onboarding (T3.3, Finding 16: "a fresh install is empty
// cards on every page"). Every step here already exists as its own feature
// (import, account classification, the Queensland preset, budgets) - this
// is sequencing and copy, not new machinery, and it self-fetches just
// enough to know which steps are already done rather than the caller
// tracking that. Renders nothing once every step is complete, so a fully
// set-up household never sees it again - no dismiss state to persist.
export default function OnboardingChecklist() {
  const [steps, setSteps] = useState(null)

  useEffect(() => {
    let cancelled = false

    Promise.all([
      api.get('/transactions?page_size=1'),
      api.get('/accounts'),
      api.get('/categories'),
    ])
      .then(([transactionsRes, accountsRes, categoriesRes]) => {
        if (cancelled) {
          return
        }

        const accounts = accountsRes.data
        const categories = categoriesRes.data

        setSteps([
          {
            key: 'import',
            label: 'Import a bank statement',
            description: 'Upload a CSV export to bring your transactions in.',
            done: transactionsRes.data.total > 0,
            linkTo: '/transactions',
            linkLabel: 'Go to Transactions',
          },
          {
            key: 'classify',
            label: 'Classify your accounts',
            description: 'Give each account a type (Everyday, Savings, Credit Card...) so balances and net worth read correctly.',
            done: accounts.length > 0 && accounts.every((account) => Boolean(account.account_type)),
            linkTo: '/accounts',
            linkLabel: 'Go to Accounts',
          },
          {
            key: 'categories',
            label: 'Set up your categories',
            description: 'Load the Queensland household preset for a starting chart of accounts, or add your own.',
            done: categories.length > 0,
            linkTo: '/categories',
            linkLabel: 'Go to Categories',
          },
          {
            key: 'budgets',
            label: 'Set your budgets',
            description: 'Give at least one expense category a standing monthly budget in Monthly Budgets.',
            done: categories.some((category) => category.budget_amount !== null && category.budget_amount !== undefined),
            linkTo: '/categories',
            linkLabel: 'Go to Monthly Budgets',
          },
        ])
      })
      .catch(() => {
        // A soft, non-critical progress card - if it can't determine
        // what's done, it just doesn't show, rather than blocking or
        // erroring the page it's mounted on.
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (!steps || steps.every((step) => step.done)) {
    return null
  }

  return (
    <Card id="dashboard-getting-started" title="Getting Started">
      <p>Four steps to a fully set-up household budget - each one only needs doing once.</p>
      <ol className="onboarding-checklist">
        {steps.map((step) => (
          <li key={step.key} className={step.done ? 'onboarding-step-done' : 'onboarding-step-pending'}>
            <span className="onboarding-step-marker" aria-hidden="true">{step.done ? '✓' : '○'}</span>
            <div>
              <strong>
                {step.label}
                {step.done && <span className="visually-hidden"> - complete</span>}
              </strong>
              <p>{step.description}</p>
              {!step.done && <Link to={step.linkTo}>{step.linkLabel}</Link>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}
