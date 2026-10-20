import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { Role } from '../types'
import {
  IconBuilding,
  IconCheckCircle,
  IconClock,
  IconKey,
  IconMapPin,
  IconNavigation,
  IconPackage,
  IconShieldCheck,
  IconTruck,
} from './Icons'
import './../styles/landing-story.css'

gsap.registerPlugin(ScrollTrigger)

const STORY_ASSETS = [
  '/images/motorcycle.png',
  '/images/parcel.png',
  '/images/parcel-open.png',
  '/images/phone-otp.png',
]

interface LandingStoryProps {
  onSelectRole: (role: Role) => void
}

interface AssetImageProps {
  src: string
  alt: string
  className?: string
}

function AssetImage({ src, alt, className }: AssetImageProps) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span
        className={`story-asset-placeholder ${className ?? ''}`}
        role="img"
        aria-label={alt}
      />
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}

function useStaticStory(): boolean {
  const [staticMode, setStaticMode] = useState(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setStaticMode(reduced.matches)
    update()
    reduced.addEventListener('change', update)
    return () => reduced.removeEventListener('change', update)
  }, [])

  return staticMode
}

export function LandingStory({ onSelectRole }: LandingStoryProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const staticMode = useStaticStory()

  useEffect(() => {
    STORY_ASSETS.forEach((src) => {
      const image = new Image()
      image.src = src
    })
  }, [])

  useEffect(() => {
    if (staticMode) return
    const root = rootRef.current
    if (!root) return

    const ctx = gsap.context(() => {
      const track = root.querySelector<HTMLElement>('.story-track')
      const scenes = gsap.utils.toArray<HTMLElement>('.story-scene', root)
      const dots = gsap.utils.toArray<HTMLElement>('.story-dots__dot', root)
      if (!track || scenes.length < 4) return

      const tl = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: {
          trigger: track,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.6,
          onUpdate: (self) => {
            const index = Math.min(
              scenes.length - 1,
              Math.max(0, Math.floor(self.progress * scenes.length + 0.15)),
            )
            dots.forEach((dot, dotIndex) =>
              dot.classList.toggle('is-active', dotIndex === index),
            )
          },
        },
      })

      const crossfade = 0.3

      scenes.forEach((scene, index) => {
        if (index > 0) {
          tl.fromTo(
            scene,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: crossfade },
            index - 0.3,
          )
        }
        if (index < scenes.length - 1) {
          tl.to(scene, { autoAlpha: 0, duration: crossfade }, index + 0.7)
        }
      })

      const parcel = root.querySelector<HTMLElement>('.js-parcel')
      const parcelOpen = root.querySelector<HTMLElement>('.js-parcel-open')
      if (parcel && parcelOpen) {
        tl.to(parcel, { autoAlpha: 0, duration: 0.12 }, 0.25)
        tl.fromTo(
          parcelOpen,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: 0.2 },
          0.25,
        )
        tl.to(parcelOpen, { autoAlpha: 0, duration: 0.15 }, 0.55)
        tl.set(parcel, { autoAlpha: 1 }, 0.7)
      }

      const bike = root.querySelector<HTMLElement>('.js-bike')
      if (bike) {
        tl.fromTo(bike, { x: -12 }, { x: 12, duration: 0.6 }, 1.05)
        tl.set(bike, { x: 0 }, 1.7)
      }

      const phone = root.querySelector<HTMLElement>('.js-phone')
      if (phone) {
        gsap.set(phone, { transformPerspective: 900, rotationY: 90 })
        tl.fromTo(
          phone,
          { autoAlpha: 0, rotationY: 90 },
          { autoAlpha: 1, rotationY: 0, duration: 0.4 },
          1.75,
        )
        tl.set(phone, { rotationY: 90 }, 2.7)
      }

      const geofence = root.querySelector<HTMLElement>('.js-geofence')
      if (geofence) {
        tl.fromTo(
          geofence,
          { autoAlpha: 0, scale: 0.55 },
          { autoAlpha: 1, scale: 1, duration: 0.35 },
          1.8,
        )
        tl.set(geofence, { scale: 0.55 }, 2.7)
      }

      const parcel4 = root.querySelector<HTMLElement>('.js-parcel4')
      if (parcel4) {
        tl.fromTo(
          parcel4,
          { autoAlpha: 0, y: 22 },
          { autoAlpha: 1, y: 0, duration: 0.3 },
          2.8,
        )
      }

      const check = root.querySelector<HTMLElement>('.js-check')
      if (check) {
        tl.fromTo(
          check,
          { autoAlpha: 0, scale: 0 },
          { autoAlpha: 1, scale: 1, duration: 0.25 },
          2.85,
        )
      }

      const ring = root.querySelector<HTMLElement>('.js-ring')
      if (ring) {
        tl.fromTo(
          ring,
          { autoAlpha: 0.9, scale: 1 },
          { autoAlpha: 0, scale: 1.7, duration: 0.3 },
          3.25,
        )
      }

      const rows = root.querySelector<HTMLElement>('.js-rows')
      if (rows) {
        tl.fromTo(
          rows,
          { autoAlpha: 0, y: 26 },
          { autoAlpha: 1, y: 0, duration: 0.4 },
          2.8,
        )
      }
    }, root)

    return () => ctx.revert()
  }, [staticMode])

  const trustChips = [
    { icon: IconShieldCheck, label: '50 m geofence' },
    { icon: IconKey, label: 'OTP handoff' },
    { icon: IconMapPin, label: 'Live tracking' },
  ]

  const roleCards: {
    role: Role
    label: string
    icon: typeof IconPackage
    copy: string
  }[] = [
    {
      role: 'customer',
      label: 'Customer',
      icon: IconPackage,
      copy: 'Send and receive packages with full tracking from booking to doorstep.',
    },
    {
      role: 'rider',
      label: 'Rider',
      icon: IconTruck,
      copy: 'Clock in for your shift and run assigned waybills with live tracking.',
    },
    {
      role: 'business',
      label: 'Business',
      icon: IconBuilding,
      copy: 'List your products and dispatch riders for customer orders.',
    },
  ]

  return (
    <div className={`story${staticMode ? ' story--static' : ''}`} ref={rootRef}>
      <section className="story-hero container" aria-label="Introduction">
        <div className="story-hero__grid">
          <div className="story-hero__copy">
            <h1 className="story-hero__headline">
              <span>Dispatch you can</span>
              <span className="story-hero__gradient">prove.</span>
            </h1>
            <p className="story-hero__sub">
              One secure platform for customers, dispatch riders and businesses
              — with geofenced proof-of-delivery, OTP recipient verification
              and boosted advertising for your listings.
            </p>
            <div className="story-hero__actions">
              <button
                type="button"
                className="btn btn--primary btn--lg"
                onClick={() => onSelectRole('customer')}
              >
                Get started
              </button>
              <a className="story-hero__link" href="#how-it-works">
                How it works
              </a>
            </div>
            <div className="story-hero__chips">
              {trustChips.map((chip) => (
                <span className="story-hero__chip" key={chip.label}>
                  <chip.icon size={14} />
                  {chip.label}
                </span>
              ))}
            </div>
          </div>
          <div className="story-hero__visual">
            <span className="story-hero__blob" aria-hidden="true" />
            <AssetImage
              src="/images/motorcycle.png"
              alt="Dispatch motorcycle with a delivery box"
              className="story-hero__bike"
            />
            <span className="story-hero__shadow" aria-hidden="true" />
          </div>
        </div>
      </section>

      {!staticMode && (
        <div className="story-dots" aria-hidden="true">
          <span className="story-dots__dot is-active" />
          <span className="story-dots__dot" />
          <span className="story-dots__dot" />
          <span className="story-dots__dot" />
        </div>
      )}

      <div className="story-track" id="how-it-works">
        <div className="story-stage">
          <div className="story-particles" aria-hidden="true">
            <span /><span /><span /><span /><span /><span />
            <span /><span /><span /><span />
          </div>

          <section className="story-scene story-scene--1" aria-label="Pick it up">
            <div className="story-scene__grid">
              <h2 className="story-headline">
                <span>PICK IT</span>
                <span>UP.</span>
              </h2>
              <div className="story-scene__image">
                <span className="story-image__blob" aria-hidden="true" />
                <AssetImage
                  src="/images/parcel.png"
                  alt="Parcel box"
                  className="js-parcel story-image-main"
                />
                <AssetImage
                  src="/images/parcel-open.png"
                  alt="Open parcel with a soft blue glow"
                  className="js-parcel-open story-image-main"
                />
              </div>
              <aside className="story-detail">
                <span className="story-detail__label">Order pickup</span>
                <p className="story-detail__copy">
                  Businesses list products and a clocked-in rider picks up the
                  order.
                </p>
                <ul className="story-detail__bullets">
                  <li><IconBuilding size={15} /> Businesses list their products</li>
                  <li><IconTruck size={15} /> A clocked-in rider picks it up</li>
                </ul>
                <button
                  type="button"
                  className="story-detail__pill"
                  onClick={() => onSelectRole('business')}
                >
                  For businesses
                </button>
              </aside>
            </div>
          </section>

          <section className="story-scene story-scene--2" aria-label="Ride it out">
            <div className="story-scene__grid">
              <h2 className="story-headline">
                <span>RIDE IT</span>
                <span>OUT.</span>
              </h2>
              <div className="story-scene__image">
                <span className="story-image__blob" aria-hidden="true" />
                <span className="js-bike story-bike-wrap">
                  <span className="story-speedlines" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                    <span />
                  </span>
                  <AssetImage
                    src="/images/motorcycle.png"
                    alt="Motorcycle riding in place"
                    className="story-bike"
                  />
                  <span className="story-bike__shadow" aria-hidden="true" />
                </span>
              </div>
              <aside className="story-detail">
                <span className="story-detail__label">Live tracking</span>
                <p className="story-detail__copy">
                  Live GPS tracking from pickup to doorstep.
                </p>
                <ul className="story-detail__bullets">
                  <li><IconMapPin size={15} /> GPS from pickup to doorstep</li>
                  <li><IconNavigation size={15} /> The route follows the ride</li>
                  <li><IconClock size={15} /> Doorstep ETA</li>
                </ul>
                <button
                  type="button"
                  className="story-detail__pill"
                  onClick={() => onSelectRole('rider')}
                >
                  For riders
                </button>
              </aside>
            </div>
          </section>

          <section className="story-scene story-scene--3" aria-label="Prove it">
            <div className="story-scene__grid">
              <h2 className="story-headline">
                <span>PROVE</span>
                <span>IT.</span>
              </h2>
              <div className="story-scene__image">
                <span className="story-image__blob" aria-hidden="true" />
                <span className="js-geofence story-geofence" />
                <AssetImage
                  src="/images/phone-otp.png"
                  alt="Phone showing a 6-digit OTP"
                  className="js-phone story-image-main"
                />
              </div>
              <aside className="story-detail">
                <span className="story-detail__label">Proof of delivery</span>
                <p className="story-detail__copy">
                  50 m geofence plus 6-digit OTP handoff.
                </p>
                <ul className="story-detail__bullets">
                  <li><IconShieldCheck size={15} /> 50 m geofence check</li>
                  <li><IconKey size={15} /> 6-digit OTP handoff</li>
                </ul>
                <button
                  type="button"
                  className="story-detail__pill"
                  onClick={() => onSelectRole('customer')}
                >
                  For customers
                </button>
              </aside>
            </div>
          </section>

          <section className="story-scene story-scene--4" aria-label="Delivered">
            <div className="story-scene__grid">
              <h2 className="story-headline">
                <span>DELIVERED.</span>
              </h2>
              <div className="story-scene__image">
                <span className="story-image__blob" aria-hidden="true" />
                <AssetImage
                  src="/images/parcel.png"
                  alt="Parcel at the doorstep"
                  className="js-parcel4 story-image-main story-image-main--side"
                />
                <span className="js-ring story-ring" />
                <span className="js-check story-check-badge">
                  <IconCheckCircle size={34} />
                </span>
                <div className="js-rows story-rows">
                  <span className="story-rows__row">Pickup confirmed</span>
                  <span className="story-rows__row">In transit (GPS live)</span>
                  <span className="story-rows__row">Delivered (OTP verified)</span>
                </div>
              </div>
              <aside className="story-detail">
                <span className="story-detail__label">Delivered &amp; proven</span>
                <p className="story-detail__copy">
                  Every step confirmed, every delivery proven.
                </p>
                <ul className="story-detail__bullets">
                  <li><IconCheckCircle size={15} /> Every step verified</li>
                  <li><IconKey size={15} /> Customer OTP match</li>
                </ul>
                <button
                  type="button"
                  className="story-detail__pill"
                  onClick={() => onSelectRole('customer')}
                >
                  For customers
                </button>
              </aside>
            </div>
          </section>
        </div>
      </div>

      <section className="story-roles container" id="roles">
        <h2 className="story-roles__heading">Choose your workspace</h2>
        <div className="story-roles__grid">
          {roleCards.map((card) => (
            <div className="story-role-card" key={card.role}>
              <span className="story-role-card__icon">
                <card.icon size={24} />
              </span>
              <h3 className="story-role-card__title">{card.label}</h3>
              <p className="story-role-card__copy">{card.copy}</p>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onSelectRole(card.role)}
              >
                Continue as {card.label}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="story-cta" aria-label="Final call to action">
        <div className="story-cta__inner container">
          <h2 className="story-cta__headline">
            Every delivery, proven from pickup to doorstep.
          </h2>
          <p className="story-cta__copy">
            Join the AZ Delivery &amp; Logistics Hub and prove every single
            dispatch.
          </p>
          <button
            type="button"
            className="story-cta__btn"
            onClick={() => onSelectRole('customer')}
          >
            Get started
          </button>
        </div>
      </section>
    </div>
  )
}
