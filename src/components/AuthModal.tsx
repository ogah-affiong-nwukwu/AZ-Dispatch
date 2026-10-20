import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent, ReactNode } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import type { RegistrationInput, Role } from '../types'
import { ROLE_LABELS, ROLE_TABS } from '../data/roles'
import type { AuthResult, SignInResult } from '../services/auth'
import {
  IconAlertTriangle,
  IconBuilding,
  IconCheckCircle,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMail,
  IconMapPin,
  IconMotorbike,
  IconPackage,
  IconPhone,
  IconStore,
  IconTruck,
  IconUserPlus,
  IconUsers,
  IconX,
} from './Icons'
import './../styles/auth.css'
import './../styles/auth-modal.css'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const VEHICLE_OPTIONS = ['Motorcycle', 'Bicycle', 'Van', 'Car', 'Truck']

const ROLE_ICONS: Record<Role, ReactNode> = {
  customer: <IconPackage size={16} />,
  rider: <IconMotorbike size={17} />,
  business: <IconStore size={16} />,
}

const ROLE_COPY: Record<Role, { title: string; sub: string }> = {
  customer: {
    title: 'Welcome back',
    sub: 'Order products and track your rider live.',
  },
  rider: {
    title: 'Ready to ride?',
    sub: 'Clock in and start taking deliveries.',
  },
  business: {
    title: 'Manage your store',
    sub: 'Upload products and review your orders.',
  },
}

const PANEL_CHECKS = ['50 m geofence', 'OTP handoff', 'Live tracking']

interface AuthModalProps {
  initialRole: Role
  initialMode: 'signin' | 'register'
  signedIn: boolean
  signedInEmail: string | null
  onClose: () => void
  onSignIn: (
    email: string,
    password: string,
    role: Role,
  ) => Promise<SignInResult | null>
  onRegister: (input: RegistrationInput) => Promise<AuthResult | null>
  onAddRole: (
    role: Role,
    options: {
      businessName?: string
      businessAddress?: string
      businessPhone?: string
      vehicleType?: string
      plateNumber?: string
      zone?: string
    },
  ) => Promise<string | null>
}

interface FormErrors {
  fullName?: string
  email?: string
  password?: string
  phone?: string
  businessName?: string
  businessAddress?: string
  businessPhone?: string
  auth?: string
}

const PHONE_PATTERN = /^\+?[0-9 ()-]{7,18}$/

function ValidMark() {
  return (
    <span className="input-valid" aria-hidden="true">
      <IconCheckCircle size={16} />
    </span>
  )
}

const fadeVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

export function AuthModal({
  initialRole,
  initialMode,
  signedIn,
  signedInEmail,
  onClose,
  onSignIn,
  onRegister,
  onAddRole,
}: AuthModalProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)
  const [role, setRole] = useState<Role>(initialRole)
  const [mode, setMode] = useState<'signin' | 'register'>(
    signedIn || initialMode === 'register' ? 'register' : 'signin',
  )
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [businessAddress, setBusinessAddress] = useState('')
  const [businessPhone, setBusinessPhone] = useState('')
  const [vehicleType, setVehicleType] = useState('Motorcycle')
  const [plateNumber, setPlateNumber] = useState('')
  const [zone, setZone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [setupRole, setSetupRole] = useState<Role | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    lastFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cardRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const card = cardRef.current
      if (!card) return
      const focusables = card.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!card.contains(document.activeElement)) {
        first.focus()
        event.preventDefault()
      } else if (event.shiftKey && document.activeElement === first) {
        last.focus()
        event.preventDefault()
      } else if (!event.shiftKey && document.activeElement === last) {
        first.focus()
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      if (lastFocused.current) lastFocused.current.focus()
    }
  }, [onClose])

  const switchRole = (nextRole: Role) => {
    setRole(nextRole)
    setErrors({})
    setNotice(null)
  }

  const handleSignInSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: FormErrors = {}
    if (!email.trim()) {
      nextErrors.email = 'Email is required.'
    } else if (!EMAIL_PATTERN.test(email.trim())) {
      nextErrors.email = 'Enter a valid email address.'
    }
    if (!password) {
      nextErrors.password = 'Password is required.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setSubmitting(true)
    console.log('[auth-modal] submitting sign-in:', { email: email.trim(), role })
    const result = await onSignIn(email, password, role)
    setSubmitting(false)
    console.log('[auth-modal] sign-in result:', result)
    if (result?.error) {
      console.error('[auth-modal] sign-in error:', result.error)
      setErrors({ auth: result.error })
      return
    }
    if (result?.missingRole) {
      console.log(
        `[auth-modal] user lacks the ${result.missingRole} role — showing setup prompt`,
      )
      setSetupRole(result.missingRole)
      setErrors({})
      return
    }
    console.log('[auth-modal] sign-in ok — closing modal')
    onClose()
  }

  const handleSetupSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!setupRole) return
    const nextErrors: FormErrors = {}
    if (setupRole === 'business') {
      if (!businessName.trim()) {
        nextErrors.businessName = 'Business name is required.'
      }
      if (!businessAddress.trim()) {
        nextErrors.businessAddress = 'Business address is required.'
      }
      if (!businessPhone.trim()) {
        nextErrors.businessPhone = 'Business phone is required.'
      } else if (!PHONE_PATTERN.test(businessPhone.trim())) {
        nextErrors.businessPhone = 'Enter a valid phone number.'
      }
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setSubmitting(true)
    console.log(`[auth-modal] setting up ${setupRole} profile…`)
    const error = await onAddRole(
      setupRole,
      setupRole === 'business'
        ? {
            businessName,
            businessAddress: businessAddress.trim(),
            businessPhone: businessPhone.trim(),
          }
        : { vehicleType, plateNumber, zone },
    )
    setSubmitting(false)
    if (error) {
      console.error('[auth-modal] role setup error:', error)
      setErrors({ auth: error })
      return
    }
    console.log('[auth-modal] role setup ok — closing modal')
    onClose()
  }

  const handleRegisterSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: FormErrors = {}
    if (!signedIn) {
      if (!fullName.trim()) nextErrors.fullName = 'Full name is required.'
      if (!phone.trim()) nextErrors.phone = 'Phone number is required.'
      if (!email.trim()) {
        nextErrors.email = 'Email is required.'
      } else if (!EMAIL_PATTERN.test(email.trim())) {
        nextErrors.email = 'Enter a valid email address.'
      }
      if (!password) {
        nextErrors.password = 'Password is required.'
      } else if (password.length < 8) {
        nextErrors.password = 'Password must be at least 8 characters.'
      }
    }
    if (role === 'business') {
      if (!businessName.trim()) {
        nextErrors.businessName = 'Business name is required.'
      }
      if (!businessAddress.trim()) {
        nextErrors.businessAddress = 'Business address is required.'
      }
      if (!businessPhone.trim()) {
        nextErrors.businessPhone = 'Business phone is required.'
      } else if (!PHONE_PATTERN.test(businessPhone.trim())) {
        nextErrors.businessPhone = 'Enter a valid phone number.'
      }
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    setSubmitting(true)
    setNotice(null)
    const result = signedIn
      ? await onAddRole(
          role,
          role === 'business'
            ? {
                businessName,
                businessAddress: businessAddress.trim(),
                businessPhone: businessPhone.trim(),
              }
            : { vehicleType, plateNumber, zone },
        )
      : await onRegister({
          fullName,
          email,
          password,
          phone,
          role,
          businessName: role === 'business' ? businessName : undefined,
          businessAddress:
            role === 'business' ? businessAddress.trim() : undefined,
          businessPhone:
            role === 'business' ? businessPhone.trim() : undefined,
          vehicleType: role === 'rider' ? vehicleType : undefined,
          plateNumber: role === 'rider' ? plateNumber : undefined,
          zone: role === 'rider' ? zone : undefined,
        })
    setSubmitting(false)
    if (signedIn) {
      if (result && typeof result === 'string') {
        console.error('[auth-modal] add-role error:', result)
        setErrors({ auth: result })
        return
      }
      onClose()
      return
    }
    if (result && typeof result === 'object' && result.notice) {
      setNotice(result.notice)
      setMode('signin')
      setPassword('')
      return
    }
    if (result && typeof result === 'object' && result.error) {
      console.error('[auth-modal] registration error:', result.error)
      setErrors({ auth: result.error })
      return
    }
    onClose()
  }

  const vehicleFields = (
    <>
      <div className="field">
        <label className="label" htmlFor="rider-vehicle-type">
          Vehicle type
        </label>
        <select
          id="rider-vehicle-type"
          className="input input--select"
          value={vehicleType}
          onChange={(event) => setVehicleType(event.target.value)}
        >
          {VEHICLE_OPTIONS.map((option) => (
            <option value={option} key={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="rider-plate">
          Vehicle plate / ID number
        </label>
        <div className="input-with-icon">
          <IconTruck size={17} className="input-leading-icon" />
          <input
            id="rider-plate"
            className="input"
            placeholder="e.g. KJA 123 QA"
            value={plateNumber}
            onChange={(event) => setPlateNumber(event.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label className="label" htmlFor="rider-zone">
          Service zone
        </label>
        <div className="input-with-icon">
          <IconMapPin size={17} className="input-leading-icon" />
          <input
            id="rider-zone"
            className="input"
            placeholder="e.g. Ikeja, Surulere"
            value={zone}
            onChange={(event) => setZone(event.target.value)}
          />
        </div>
      </div>
    </>
  )

  const businessDetailFields = (
    <>
      <div className="field">
        <label className="label" htmlFor="business-address">
          Business address
        </label>
        <div className="input-with-icon">
          <IconMapPin size={17} className="input-leading-icon" />
          <input
            id="business-address"
            className={`input ${errors.businessAddress ? 'input--error' : ''}`}
            type="text"
            placeholder="e.g. 12 Adeniran Ogunsanya, Surulere"
            value={businessAddress}
            onChange={(event) => setBusinessAddress(event.target.value)}
          />
          {!errors.businessAddress && businessAddress.trim() && <ValidMark />}
        </div>
        {errors.businessAddress && (
          <p className="field-error">
            <IconAlertTriangle size={14} />
            {errors.businessAddress}
          </p>
        )}
      </div>
      <div className="field">
        <label className="label" htmlFor="business-phone">
          Business phone
        </label>
        <div className="input-with-icon">
          <IconPhone size={17} className="input-leading-icon" />
          <input
            id="business-phone"
            className={`input ${errors.businessPhone ? 'input--error' : ''}`}
            type="tel"
            inputMode="tel"
            placeholder="+234 800 000 0000"
            value={businessPhone}
            onChange={(event) => setBusinessPhone(event.target.value)}
          />
          {!errors.businessPhone && PHONE_PATTERN.test(businessPhone.trim()) && (
            <ValidMark />
          )}
        </div>
        {errors.businessPhone && (
          <p className="field-error">
            <IconAlertTriangle size={14} />
            {errors.businessPhone}
          </p>
        )}
      </div>
    </>
  )

  const headTitle = setupRole
    ? `Set up your ${ROLE_LABELS[setupRole]} profile`
    : signedIn
      ? 'Add another role'
      : mode === 'register'
        ? 'Create your account'
        : ROLE_COPY[role].title

  const headSub = setupRole
    ? `You don't have a ${ROLE_LABELS[setupRole]} profile yet. Set one up to continue.`
    : signedIn
      ? 'Add another role to your account, then switch between roles from the dashboard header.'
      : ROLE_COPY[role].sub

  const headIcon = setupRole ? (
    <IconTruck size={22} />
  ) : signedIn ? (
    <IconBuilding size={22} />
  ) : mode === 'register' ? (
    <IconUserPlus size={22} />
  ) : (
    ROLE_ICONS[role]
  )

  return createPortal(
    <MotionConfig reducedMotion="user">
      <div
        className="auth-overlay"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <motion.div
          className="auth-modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-modal-title"
          ref={cardRef}
          tabIndex={-1}
          initial={{ opacity: 0, scale: 0.95, y: 14 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <button
            type="button"
            className="auth-modal__close"
            onClick={onClose}
            aria-label="Close sign in"
          >
            <IconX size={16} />
          </button>

          <aside className="auth-split__panel" aria-hidden="true">
            <img
              src="/images/motorcycle.png"
              className="auth-panel__bike"
              alt=""
              draggable={false}
            />
            <h2 className="auth-panel__title">Every delivery, proven.</h2>
            <ul className="auth-panel__checks">
              {PANEL_CHECKS.map((line) => (
                <li key={line}>
                  <IconCheckCircle size={15} />
                  {line}
                </li>
              ))}
            </ul>
          </aside>

          <div className="auth-split__form">
            <div className="auth__head">
              <span className="auth__logo">{headIcon}</span>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`${mode}-${role}-${setupRole ?? 'none'}`}
                  variants={fadeVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.18 }}
                >
                  <h1 id="auth-modal-title">{headTitle}</h1>
                  <p>{headSub}</p>
                </motion.div>
              </AnimatePresence>
            </div>

            {notice && (
              <div className="auth__notice">
                <IconMail size={15} />
                {notice}
              </div>
            )}

            <AnimatePresence mode="wait" initial={false}>
              {setupRole ? (
                <motion.form
                  key="setup"
                  onSubmit={handleSetupSubmit}
                  noValidate
                  variants={fadeVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.18 }}
                >
                  {setupRole === 'business' && (
                    <div className="field">
                      <label className="label" htmlFor="setup-business-name">
                        Business name
                      </label>
                      <div className="input-with-icon">
                        <IconStore size={17} className="input-leading-icon" />
                        <input
                          id="setup-business-name"
                          className={`input ${errors.businessName ? 'input--error' : ''}`}
                          type="text"
                          placeholder="e.g. Fresh Foods Logistics"
                          value={businessName}
                          onChange={(event) =>
                            setBusinessName(event.target.value)
                          }
                        />
                        {!errors.businessName && businessName.trim() && (
                          <ValidMark />
                        )}
                      </div>
                      {errors.businessName && (
                        <p className="field-error">
                          <IconAlertTriangle size={14} />
                          {errors.businessName}
                        </p>
                      )}
                    </div>
                  )}
                  {setupRole === 'business' && businessDetailFields}
                  {setupRole === 'rider' && vehicleFields}
                  {errors.auth && (
                    <div className="auth__error">
                      <IconAlertTriangle size={16} />
                      {errors.auth}
                    </div>
                  )}
                  <button
                    type="submit"
                    className="auth-submit"
                    disabled={submitting}
                  >
                    {submitting ? (
                      <span className="btn-spinner" aria-hidden="true" />
                    ) : (
                      <IconUserPlus size={17} />
                    )}
                    {submitting
                      ? 'Setting up…'
                      : `Set up ${ROLE_LABELS[setupRole]} profile`}
                  </button>
                  <button
                    type="button"
                    className="auth__switch"
                    onClick={() => {
                      setSetupRole(null)
                      setErrors({})
                    }}
                  >
                    Back
                  </button>
                </motion.form>
              ) : (
                <motion.div
                  key={`${signedIn}-${mode}`}
                  variants={fadeVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.18 }}
                >
                  <div
                    className="role-tabs"
                    role="tablist"
                    aria-label="Account role"
                  >
                    {ROLE_TABS.map((tab) => {
                      const active = role === tab.role
                      return (
                        <button
                          type="button"
                          role="tab"
                          aria-selected={active}
                          className={`role-tabs__btn ${active ? 'role-tabs__btn--active' : ''}`}
                          key={tab.role}
                          onClick={() => switchRole(tab.role)}
                        >
                          {active && (
                            <motion.span
                              layoutId="role-tab-pill"
                              className="role-tabs__pill"
                              transition={{
                                type: 'spring',
                                stiffness: 480,
                                damping: 36,
                              }}
                            />
                          )}
                          <span className="role-tabs__label">
                            {ROLE_ICONS[tab.role]}
                            {tab.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  {signedIn ? (
                    <form onSubmit={handleRegisterSubmit} noValidate>
                      <div className="auth__note">
                        <IconMail size={15} />
                        Adding a role to {signedInEmail ?? 'your account'}
                      </div>
                      {role === 'business' && (
                        <div className="field">
                          <label className="label" htmlFor="register-business">
                            Business name
                          </label>
                          <div className="input-with-icon">
                            <IconStore
                              size={17}
                              className="input-leading-icon"
                            />
                            <input
                              id="register-business"
                              className={`input ${errors.businessName ? 'input--error' : ''}`}
                              type="text"
                              placeholder="e.g. Fresh Foods Logistics"
                              value={businessName}
                              onChange={(event) =>
                                setBusinessName(event.target.value)
                              }
                            />
                            {!errors.businessName && businessName.trim() && (
                              <ValidMark />
                            )}
                          </div>
                          {errors.businessName && (
                            <p className="field-error">
                              <IconAlertTriangle size={14} />
                              {errors.businessName}
                            </p>
                          )}
                        </div>
                      )}
                      {role === 'business' && businessDetailFields}
                      {role === 'rider' && vehicleFields}
                      {errors.auth && (
                        <div className="auth__error">
                          <IconAlertTriangle size={16} />
                          {errors.auth}
                        </div>
                      )}
                      <button
                        type="submit"
                        className="auth-submit"
                        disabled={submitting}
                      >
                        {submitting ? (
                          <span className="btn-spinner" aria-hidden="true" />
                        ) : (
                          <IconUserPlus size={17} />
                        )}
                        {submitting
                          ? 'Adding role…'
                          : `Add ${ROLE_LABELS[role]} role`}
                      </button>
                    </form>
                  ) : mode === 'signin' ? (
                    <form onSubmit={handleSignInSubmit} noValidate>
                      <div className="field">
                        <label className="label" htmlFor="login-email">
                          Email address
                        </label>
                        <div className="input-with-icon">
                          <IconMail
                            size={17}
                            className="input-leading-icon"
                          />
                          <input
                            id="login-email"
                            className={`input ${errors.email ? 'input--error' : ''}`}
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                          />
                          {!errors.email &&
                            EMAIL_PATTERN.test(email.trim()) && <ValidMark />}
                        </div>
                        {errors.email && (
                          <p className="field-error">
                            <IconAlertTriangle size={14} />
                            {errors.email}
                          </p>
                        )}
                      </div>

                      <div className="field">
                        <div className="auth-label-row">
                          <label className="label" htmlFor="login-password">
                            Password
                          </label>
                          <button
                            type="button"
                            className="auth-forgot"
                            onClick={() =>
                              setNotice(
                                'Password reset will be available soon. Contact support to reset your password.',
                              )
                            }
                          >
                            Forgot password?
                          </button>
                        </div>
                        <div className="input-with-icon">
                          <IconLock
                            size={17}
                            className="input-leading-icon"
                          />
                          <input
                            id="login-password"
                            className={`input ${errors.password ? 'input--error' : ''}`}
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="current-password"
                            placeholder="Enter your password"
                            value={password}
                            onChange={(event) =>
                              setPassword(event.target.value)
                            }
                          />
                          {!errors.password && password.length >= 8 && (
                            <span
                              className="input-valid input-valid--with-eye"
                              aria-hidden="true"
                            >
                              <IconCheckCircle size={16} />
                            </span>
                          )}
                          <button
                            type="button"
                            className="input-icon-btn"
                            onClick={() =>
                              setShowPassword((value) => !value)
                            }
                            aria-label={
                              showPassword
                                ? 'Hide password'
                                : 'Show password'
                            }
                          >
                            {showPassword ? (
                              <IconEyeOff size={17} />
                            ) : (
                              <IconEye size={17} />
                            )}
                          </button>
                        </div>
                        {errors.password && (
                          <p className="field-error">
                            <IconAlertTriangle size={14} />
                            {errors.password}
                          </p>
                        )}
                      </div>

                      {errors.auth && (
                        <div className="auth__error">
                          <IconAlertTriangle size={16} />
                          {errors.auth}
                        </div>
                      )}

                      <button
                        type="submit"
                        className="auth-submit"
                        disabled={submitting}
                      >
                        {submitting ? (
                          <span className="btn-spinner" aria-hidden="true" />
                        ) : (
                          <IconLock size={17} />
                        )}
                        {submitting ? 'Signing in…' : 'Sign in'}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleRegisterSubmit} noValidate>
                      <div className="field">
                        <label className="label" htmlFor="register-name">
                          Full name
                        </label>
                        <div className="input-with-icon">
                          <IconUsers
                            size={17}
                            className="input-leading-icon"
                          />
                          <input
                            id="register-name"
                            className={`input ${errors.fullName ? 'input--error' : ''}`}
                            type="text"
                            autoComplete="name"
                            placeholder="e.g. Ada Obi"
                            value={fullName}
                            onChange={(event) =>
                              setFullName(event.target.value)
                            }
                          />
                          {!errors.fullName && fullName.trim() && <ValidMark />}
                        </div>
                        {errors.fullName && (
                          <p className="field-error">
                            <IconAlertTriangle size={14} />
                            {errors.fullName}
                          </p>
                        )}
                      </div>

                      <div className="field">
                        <label className="label" htmlFor="register-phone">
                          Phone number
                        </label>
                        <div className="input-with-icon">
                          <IconPhone
                            size={17}
                            className="input-leading-icon"
                          />
                          <input
                            id="register-phone"
                            className={`input ${errors.phone ? 'input--error' : ''}`}
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            placeholder="+234 800 000 0000"
                            value={phone}
                            onChange={(event) => setPhone(event.target.value)}
                          />
                          {!errors.phone && phone.trim() && <ValidMark />}
                        </div>
                        {errors.phone && (
                          <p className="field-error">
                            <IconAlertTriangle size={14} />
                            {errors.phone}
                          </p>
                        )}
                      </div>

                      {role === 'business' && (
                        <div className="field">
                          <label className="label" htmlFor="register-business">
                            Business name
                          </label>
                          <div className="input-with-icon">
                            <IconStore
                              size={17}
                              className="input-leading-icon"
                            />
                            <input
                              id="register-business"
                              className={`input ${errors.businessName ? 'input--error' : ''}`}
                              type="text"
                              placeholder="e.g. Fresh Foods Logistics"
                              value={businessName}
                              onChange={(event) =>
                                setBusinessName(event.target.value)
                              }
                            />
                            {!errors.businessName && businessName.trim() && (
                              <ValidMark />
                            )}
                          </div>
                          {errors.businessName && (
                            <p className="field-error">
                              <IconAlertTriangle size={14} />
                              {errors.businessName}
                            </p>
                          )}
                        </div>
                      )}

                      {role === 'business' && businessDetailFields}

                      {role === 'rider' && vehicleFields}

                      <div className="field">
                        <label className="label" htmlFor="register-email">
                          Email address
                        </label>
                        <div className="input-with-icon">
                          <IconMail
                            size={17}
                            className="input-leading-icon"
                          />
                          <input
                            id="register-email"
                            className={`input ${errors.email ? 'input--error' : ''}`}
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            placeholder="you@example.com"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                          />
                          {!errors.email &&
                            EMAIL_PATTERN.test(email.trim()) && <ValidMark />}
                        </div>
                        {errors.email && (
                          <p className="field-error">
                            <IconAlertTriangle size={14} />
                            {errors.email}
                          </p>
                        )}
                      </div>

                      <div className="field">
                        <div className="auth-label-row">
                          <label className="label" htmlFor="register-password">
                            Password
                          </label>
                          <button
                            type="button"
                            className="auth-forgot"
                            onClick={() =>
                              setNotice(
                                'Password reset will be available soon. Contact support to reset your password.',
                              )
                            }
                          >
                            Forgot password?
                          </button>
                        </div>
                        <div className="input-with-icon">
                          <IconLock
                            size={17}
                            className="input-leading-icon"
                          />
                          <input
                            id="register-password"
                            className={`input ${errors.password ? 'input--error' : ''}`}
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            placeholder="At least 8 characters"
                            value={password}
                            onChange={(event) =>
                              setPassword(event.target.value)
                            }
                          />
                          {!errors.password && password.length >= 8 && (
                            <span
                              className="input-valid input-valid--with-eye"
                              aria-hidden="true"
                            >
                              <IconCheckCircle size={16} />
                            </span>
                          )}
                          <button
                            type="button"
                            className="input-icon-btn"
                            onClick={() =>
                              setShowPassword((value) => !value)
                            }
                            aria-label={
                              showPassword
                                ? 'Hide password'
                                : 'Show password'
                            }
                          >
                            {showPassword ? (
                              <IconEyeOff size={17} />
                            ) : (
                              <IconEye size={17} />
                            )}
                          </button>
                        </div>
                        {errors.password && (
                          <p className="field-error">
                            <IconAlertTriangle size={14} />
                            {errors.password}
                          </p>
                        )}
                      </div>

                      {errors.auth && (
                        <div className="auth__error">
                          <IconAlertTriangle size={16} />
                          {errors.auth}
                        </div>
                      )}

                      <button
                        type="submit"
                        className="auth-submit"
                        disabled={submitting}
                      >
                        {submitting ? (
                          <span className="btn-spinner" aria-hidden="true" />
                        ) : (
                          <IconUserPlus size={17} />
                        )}
                        {submitting
                          ? 'Creating account…'
                          : `Create ${ROLE_LABELS[role]} account`}
                      </button>
                    </form>
                  )}

                  {!signedIn && (
                    <button
                      type="button"
                      className="auth__switch"
                      onClick={() => {
                        setMode((value) =>
                          value === 'signin' ? 'register' : 'signin',
                        )
                        setErrors({})
                        setNotice(null)
                      }}
                    >
                      {mode === 'signin'
                        ? 'New to AZ Delivery? Create an account'
                        : 'Already have an account? Sign in instead'}
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </MotionConfig>,
    document.body,
  )
}
