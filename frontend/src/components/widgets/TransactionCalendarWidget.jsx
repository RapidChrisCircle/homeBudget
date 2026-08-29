import { useEffect, useState } from 'react'
import TransactionCalendar from './TransactionCalendar.jsx'
import ErrorState from '../ErrorState.jsx'
import LoadingState from '../LoadingState.jsx'
import { api } from '../../services/api'
import { monthsBack, periodsDateRange } from '../../utils/calendar.js'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Fetches its own GET /reports/daily, unlike most widgets - a day-level
// window is genuinely per-widget (config.months decides how many month
// grids to show), unlike the shared multi-month data DashboardPage already
// fetches once for every chart on the page. One request covers however
// many months config.months asks for; the response is then split back out
// per month for TransactionCalendar (which draws exactly one month).
export default function TransactionCalendarWidget({ config, navigate }) {
  const months = config?.months || 1
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const periods = monthsBack(new Date().getFullYear(), new Date().getMonth() + 1, months)

  useEffect(() => {
    let cancelled = false

    setLoading(true)
    setError('')

    const { from, to } = periodsDateRange(periods)

    api.get(`/reports/daily?date_from=${from}&date_to=${to}`)
      .then((response) => {
        if (!cancelled) {
          setRows(response.data)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.response?.data?.detail || err?.message || 'Unknown error')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months])

  if (loading) {
    return <LoadingState message="Loading calendar..." />
  }

  if (error) {
    return <ErrorState label="Failed to load calendar:" message={error} />
  }

  return (
    <>
      {periods.map(({ year, month }) => {
        const prefix = `${year}-${String(month).padStart(2, '0')}`
        const monthDays = rows.filter((row) => row.date.startsWith(prefix))

        return (
          <TransactionCalendar
            key={prefix}
            year={year}
            month={month}
            monthLabel={`${MONTH_NAMES[month - 1]} ${year}`}
            days={monthDays}
            onSelectDay={(date) => navigate(`/transactions?date_from=${date}&date_to=${date}`)}
          />
        )
      })}
    </>
  )
}
