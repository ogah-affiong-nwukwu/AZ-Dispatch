import type { Role } from '../types'
import type { ThemeMode } from '../utils/storage'
import { Brand } from './Brand'
import {
  IconMapPin,
  IconPackage,
  IconPower,
  IconShieldCheck,
  IconUsers,
  IconZap,
} from './Icons'
import { LandingStory } from './LandingStory'
import { ThemeToggle } from './ThemeToggle'
import './../styles/landing.css'

interface LandingPageProps {
  theme: ThemeMode
  onToggleTheme: () => void
  onSelectRole: (role: Role) => void
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
          <nav className="landing__topbar-links" aria-label="Landing page sections">
            <a href="#how-it-works">How it works</a>
            <a href="#features">Features</a>
            <a href="#roles">Roles</a>
          </nav>
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
        <LandingStory onSelectRole={onSelectRole} />

        <section className="landing__features container" id="features">
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
              Customers order from any business and a clocked-in rider picks it
              up — with a full tracking timeline at every step.
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
