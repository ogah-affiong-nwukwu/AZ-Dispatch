import { IconRefresh } from './Icons'
import { resetDemoData } from '../utils/storage'

export function DashboardFooter() {
  const handleReset = () => {
    const confirmed = window.confirm(
      'Reset all data (accounts, orders and campaigns)?',
    )
    if (!confirmed) return
    resetDemoData()
    window.location.reload()
  }

  return (
    <footer className="dash-footer">
      <div className="dash-footer__inner container">
        <span>
          AZ Delivery &amp; Logistics Hub — pay only to the official AZ company
          account.
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={handleReset}
        >
          <IconRefresh size={15} />
          Reset all data
        </button>
      </div>
    </footer>
  )
}
