import { IconLogo } from './Icons'

export function Brand() {
  return (
    <div className="brand">
      <IconLogo size={34} />
      <span className="brand-wordmark">
        AZ Delivery
        <em>&amp; Logistics Hub</em>
      </span>
    </div>
  )
}
