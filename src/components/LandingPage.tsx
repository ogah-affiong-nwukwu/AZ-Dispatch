import type { Role } from '../types'
import type { ThemeMode } from '../utils/storage'
import { Brand } from './Brand'
import {
  IconBuilding,
  IconCheckCircle,
  IconLogo,
  IconMapPin,
  IconPackage,
  IconPower,
  IconShieldCheck,
  IconTruck,
  IconUsers,
  IconZap,
} from './Icons'
import { ThemeToggle } from './ThemeToggle'
import './../styles/landing.css'

interface LandingPageProps {
  theme: ThemeMode
  onToggleTheme: () => void
  onSelectRole: (role: Role) => void
}

function TransitMapGraphic() {
  return (
    <div className="map-card" aria-label="Live delivery transit map">
      <div className="map-card__badge">
        <span className="map-dot" />
        Fleet dispatch · GPS-tracked
      </div>
      <span className="map-card__live">
        <span className="map-dot map-dot--live" />
        LIVE
      </span>

      <svg
        className="map-svg"
        viewBox="0 0 340 380"
        role="img"
        aria-label="A delivery bike travelling a route between a pickup and drop-off point"
      >
        <rect
          x="18"
          y="18"
          width="110"
          height="132"
          rx="14"
          fill="var(--primary-soft-strong)"
          opacity="0.5"
        />
        <rect
          x="198"
          y="18"
          width="124"
          height="132"
          rx="14"
          fill="var(--primary-soft-strong)"
          opacity="0.38"
        />
        <rect
          x="18"
          y="202"
          width="110"
          height="148"
          rx="14"
          fill="var(--primary-soft-strong)"
          opacity="0.42"
        />
        <rect
          x="198"
          y="202"
          width="124"
          height="148"
          rx="14"
          fill="var(--primary-soft-strong)"
          opacity="0.5"
        />

        <g
          stroke="var(--surface)"
          strokeWidth="11"
          strokeLinecap="round"
          fill="none"
        >
          <path d="M0 176 H 340" />
          <path d="M163 0 V 380" />
        </g>
        <g
          stroke="var(--surface)"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
          opacity="0.9"
        >
          <path d="M72 202 V 350" />
          <path d="M258 18 V 150" />
        </g>

        <path
          className="map-route"
          d="M52 176 H 145 Q 163 176 163 194 V 62"
          fill="none"
        />

        <g>
          <circle cx="52" cy="176" r="11" fill="var(--primary)" />
          <circle cx="52" cy="176" r="4" fill="#ffffff" />
        </g>

        <g>
          <circle cx="163" cy="62" r="13" fill="var(--accent)" />
          <circle cx="163" cy="62" r="5" fill="#ffffff" />
        </g>
        <circle
          className="map-pulse"
          cx="163"
          cy="62"
          r="13"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="3"
        />

        <g transform="translate(163 232) scale(0.92)">
          <g className="map-bike">
            <ellipse cx="0" cy="26" rx="40" ry="7" fill="var(--border)" />
            <g
              stroke="var(--text-strong)"
              strokeWidth="3.4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="-26" cy="14" r="11" />
              <circle cx="26" cy="14" r="11" />
              <path d="M-26 14 -9 14" />
              <path d="M-9 14 3 -18" />
              <path d="M-9 14 -3 -13" />
              <path d="M3 -18 11 -18" />
              <path d="M-3 -13 26 14" />
              <path d="M-3 -13 9 -18" />
            </g>
            <circle cx="-9" cy="14" r="2.6" fill="var(--text-strong)" />
            <rect
              x="-40"
              y="-4"
              width="15"
              height="13"
              rx="3"
              fill="var(--primary)"
            />
          </g>
        </g>
      </svg>

      <div className="map-card__rider">
        <span className="map-card__avatar map-card__avatar--brand">
          <IconLogo size={36} />
        </span>
        <span className="map-card__rider-meta">
          <strong>AZ Fleet Status</strong>
          <small>Riders appear here after clock-in</small>
        </span>
      </div>

      <div className="map-card__gps">
        <IconShieldCheck size={16} />
        GPS-locked · 50 m geofence · OTP-verified handoff
      </div>
    </div>
  )
}

export function LandingPage({
  theme,
  onToggleTheme,
  onSelectRole,
}: LandingPageProps) {
  return (
    <div className="landing">
      <div className="landing__topbar">
        <div className="landing__topbar-inner container">
          <Brand />
          <div className="landing__topbar-actions">
            <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => onSelectRole('customer')}
            >
              Sign in
            </button>
          </div>
        </div>
      </div>

      <main className="landing__main">
        <section className="landing__hero container">
          <div className="landing__hero-copy">
            <span className="landing__eyebrow">
              <IconShieldCheck size={15} />
              GPS-verified proof of delivery
            </span>
            <h1>Delivery you can prove, from pickup to doorstep.</h1>
            <p>
              AZ Delivery &amp; Logistics Hub connects customers, dispatch
              riders and businesses on one secure platform — with geofenced
              proof-of-delivery, OTP recipient verification and boosted
              advertising for your listings.
            </p>
            <div className="landing__hero-actions">
              <button
                type="button"
                className="btn btn--primary btn--lg"
                onClick={() => onSelectRole('customer')}
              >
                Continue as Customer
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--lg"
                onClick={() => onSelectRole('rider')}
              >
                Continue as Rider
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--lg"
                onClick={() => onSelectRole('business')}
              >
                Continue as Business
              </button>
            </div>
          </div>

          <div className="landing__hero-visual">
            <TransitMapGraphic />
          </div>
        </section>

        <section className="landing__features container">
          <div className="card feature">
            <span className="feature__icon">
              <IconMapPin size={22} />
            </span>
            <h3>Geofenced proof-of-delivery</h3>
            <p>
              Every drop-off is confirmed inside a 50-metre geofence around the
              recipient&apos;s location, backed by a GPS reading.
            </p>
          </div>
          <div className="card feature">
            <span className="feature__icon">
              <IconPackage size={22} />
            </span>
            <h3>Live order workflow</h3>
            <p>
              Customers submit orders that businesses approve and assign to
              riders, with a full tracking timeline at every step.
            </p>
          </div>
          <div className="card feature">
            <span className="feature__icon">
              <IconZap size={22} />
            </span>
            <h3>Boost orders &amp; advertise</h3>
            <p>
              Riders and small businesses can promote listings or boost
              deliveries with instant Flutterwave test payments.
            </p>
          </div>
        </section>

        <section className="landing__roles container">
          <div className="landing__roles-head">
            <h2>Choose how you want to use the platform</h2>
            <p>
              One secure account system, three distinct workspaces — pick the
              one that matches you.
            </p>
          </div>

          <div className="role-grid">
            <div className="card role-card">
              <span className="role-card__icon">
                <IconPackage size={24} />
              </span>
              <h3>Customer / Recipient</h3>
              <p>
                Send and receive packages with full visibility from booking to
                doorstep confirmation.
              </p>
              <ul>
                <li>
                  <IconCheckCircle size={17} />
                  Submit live orders with a custom drop-off location
                </li>
                <li>
                  <IconCheckCircle size={17} />
                  Track approval, dispatch and delivery statuses
                </li>
                <li>
                  <IconCheckCircle size={17} />
                  Confirm riders with a 6-digit OTP handshake
                </li>
              </ul>
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => onSelectRole('customer')}
              >
                Continue as Customer
              </button>
            </div>

            <div className="card role-card role-card--rider">
              <span className="role-card__icon">
                <IconTruck size={24} />
              </span>
              <h3>Dispatch Rider</h3>
              <p>
                Clock in for your shift from the dedicated Rider Portal and
                receive waybills from businesses.
              </p>
              <ul>
                <li>
                  <IconCheckCircle size={17} />
                  Clock in with your vehicle details to join the assignment
                  queue
                </li>
                <li>
                  <IconCheckCircle size={17} />
                  Run assigned routes with live tracking
                </li>
                <li>
                  <IconCheckCircle size={17} />
                  Confirm deliveries with GPS geofence + OTP verification
                </li>
              </ul>
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => onSelectRole('rider')}
              >
                Continue as Rider
              </button>
            </div>

            <div className="card role-card">
              <span className="role-card__icon">
                <IconBuilding size={24} />
              </span>
              <h3>Business</h3>
              <p>
                Review customer orders, approve them and assign available
                riders from the clocked-in queue.
              </p>
              <ul>
                <li>
                  <IconCheckCircle size={17} />
                  Approve orders and assign clocked-in dispatch riders
                </li>
                <li>
                  <IconCheckCircle size={17} />
                  Follow today&apos;s order pipeline in one view
                </li>
                <li>
                  <IconCheckCircle size={17} />
                  Search order history by date or order ID
                </li>
              </ul>
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => onSelectRole('business')}
              >
                Continue as Business
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing__footer">
        <div className="landing__footer-inner container">
          <span className="footer-item">
            <IconUsers size={14} /> Customers, riders &amp; businesses on one
            platform
          </span>
          <span className="footer-item">
            <IconShieldCheck size={14} /> 50 m geofence enforcement
          </span>
          <span className="footer-item">
            <IconPower size={14} /> Riders join the queue by clocking in
          </span>
        </div>
      </footer>
    </div>
  )
}
