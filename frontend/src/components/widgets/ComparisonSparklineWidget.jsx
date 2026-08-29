import { useEffect, useState } from 'react'
import ComparisonSparkline from './ComparisonSparkline.jsx'
import ErrorState from '../ErrorState.jsx'
import LoadingState from '../LoadingState.jsx'
import { api } from '../../services/api'
import { monthsBack, periodsDateRange } from '../../utils/calendar.js'
import { averageCumulative, budgetPace, cumulativeSpendByDay } from '../../utils/sparklineComparison.js'

export const COMPARISON_BASES = ['last_month', 'three_month_average', 'budget']

const COMPARISON_LABELS = {
  last_month: 'Last month',
  three_month_average: '3-month average',
  budget: 'Budget',
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// Fetches its own data - unlike most widgets, the comparison basis
// (config.comparisonBasis) decides genuinely different sources (a prior
// month's GET /reports/daily, three of them averaged, or a flat
// GET /budgets total), which the shared dashboard-wide fetch DashboardPage
// already does for every OTHER widget has no reason to also carry. Pure
// day-arithmetic is left to utils/sparklineComparison.js and
// utils/calendar.js; this component only orchestrates which of those to
// call for the chosen basis.
export default function ComparisonSparklineWidget({ config, navigate }) {
  const basis = COMPARISON_BASES.includes(config?.comparisonBasis) ? config.comparisonBasis : 'last_month'
  const [state, setState] = useState({ loading: true, error: '', result: null })

  useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: '', result: null })

    const today = new Date()
    const year = today.getFullYear()
    const month = today.getMonth() + 1
    const thisMonthDayCount = daysInMonth(year, month)
    const knownThroughDay = today.getDate()
    const [thisMonthPeriod] = monthsBack(year, month, 1)
    const { from: thisMonthFrom, to: thisMonthTo } = periodsDateRange([thisMonthPeriod])

    const buildResult = (thisMonthRows, comparisonValues) => ({
      periods: Array.from({ length: thisMonthDayCount }, (_, i) => String(i + 1)),
      thisMonthValues: cumulativeSpendByDay(thisMonthDayCount, thisMonthRows, knownThroughDay),
      comparisonValues,
      comparisonLabel: COMPARISON_LABELS[basis],
    })

    let request

    if (basis === 'budget') {
      request = Promise.all([
        api.get(`/reports/daily?date_from=${thisMonthFrom}&date_to=${thisMonthTo}`),
        api.get(`/budgets?year=${year}&month=${month}`),
      ]).then(([dailyRes, budgetRes]) => buildResult(
        dailyRes.data,
        budgetPace(thisMonthDayCount, budgetRes.data.totals.budgeted)
      ))
    } else {
      const priorCount = basis === 'three_month_average' ? 3 : 1
      const priorPeriods = monthsBack(year, month, priorCount + 1).slice(0, priorCount)
      const { from: priorFrom, to: priorTo } = periodsDateRange(priorPeriods)

      request = Promise.all([
        api.get(`/reports/daily?date_from=${thisMonthFrom}&date_to=${thisMonthTo}`),
        api.get(`/reports/daily?date_from=${priorFrom}&date_to=${priorTo}`),
      ]).then(([thisMonthRes, priorRes]) => {
        const perMonthSeries = priorPeriods.map(({ year: py, month: pm }) => {
          const prefix = `${py}-${String(pm).padStart(2, '0')}`
          const monthRows = priorRes.data.filter((row) => row.date.startsWith(prefix))
          return cumulativeSpendByDay(thisMonthDayCount, monthRows)
        })

        const comparisonValues = priorCount === 1 ? perMonthSeries[0] : averageCumulative(perMonthSeries)

        return buildResult(thisMonthRes.data, comparisonValues)
      })
    }

    request
      .then((result) => {
        if (!cancelled) {
          setState({ loading: false, error: '', result })
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ loading: false, error: err?.response?.data?.detail || err?.message || 'Unknown error', result: null })
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basis])

  if (state.loading) {
    return <LoadingState message="Loading..." />
  }

  if (state.error) {
    return <ErrorState label="Failed to load:" message={state.error} />
  }

  const today = new Date()
  const monthPrefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  return (
    <ComparisonSparkline
      {...state.result}
      onSelectPoint={({ period }) => {
        const date = `${monthPrefix}-${String(period).padStart(2, '0')}`
        navigate(`/transactions?date_from=${date}&date_to=${date}`)
      }}
    />
  )
}
