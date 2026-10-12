import { useState } from 'react'
import type { FormEvent } from 'react'
import type { RegistrationInput, Role, User } from '../types'
import { Brand } from './Brand'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMail,
  IconUserPlus,
} from './Icons'
import './../styles/auth.css'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ROLE_TABS: { role: Role; label: string }[] = [
  { role: 'customer', label: 'Customer' },
  { role: 'rider', label: 'Rider' },
  { role: 'business', label: 'Business' },
]

const ROLE_LABEL: Record<Role, string> = {
  customer: 'customer',
  rider: 'rider',
  business: 'business',
}

interface LoginViewProps {
  initialRole: Role
  users: User[]
  onBack: () => void
  onSuccess: (user: User, remembered: boolean) => void
  onRegister: (input: RegistrationInput) => string | null
}

interface FormErrors {
  fullName?: string
  email?: string
  password?: string
  phone?: string
  businessName?: string
  auth?: string
}

type AuthMode = 'signin' | 'register'

export function LoginView({
  initialRole,
  users,
  onBack,
  onSuccess,
  onRegister,
}: LoginViewProps) {
  const [role, setRole] = useState<Role>(initialRole)
  const [mode, setMode] = useState<AuthMode>('signin')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  const switchRole = (nextRole: Role) => {
    setRole(nextRole)
    setErrors({})
  }

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setErrors({})
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: FormErrors = {}
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
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    window.setTimeout(() => {
      const match = users.find(
        (user) =>
          user.role === role &&
          user.email.toLowerCase() === email.trim().toLowerCase() &&
          user.password === password,
      )
      if (!match) {
        setErrors({
          auth: `No ${ROLE_LABEL[role]} account matches these credentials.`,
        })
        setSubmitting(false)
        return
      }
      onSuccess(match, remember)
    }, 550)
  }

  const handleRegisterSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: FormErrors = {}
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
    if (role === 'business' && !businessName.trim()) {
      nextErrors.businessName = 'Business name is required.'
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    const error = onRegister({
      fullName,
      email,
      password,
      phone,
      role,
      businessName: role === 'business' ? businessName : undefined,
    })
    if (error) {
      setErrors({ auth: error })
    }
  }

  const headCopy =
    mode === 'register'
      ? 'Create your AZ Delivery account to start ordering, riding or dispatching.'
      : role === 'customer'
        ? 'Track packages, manage your address and verify deliveries.'
        : role === 'rider'
          ? 'Clock in for your shift and run assigned waybills.'
          : 'Review orders, assign riders and search order history.'

  return (
    <div className="auth">
      <div className="auth__topbar">
        <div className="auth__topbar-inner container">
          <Brand />
        </div>
      </div>

      <main className="auth__main">
        <div className="auth__card">
          <button type="button" className="auth__back" onClick={onBack}>
            <IconArrowLeft size={15} />
            Back to role selection
          </button>

          <div className="auth__head">
            <span className="auth__logo">
              {mode === 'register' ? (
                <IconUserPlus size={22} />
              ) : (
                <IconLock size={22} />
              )}
            </span>
            <h1>
              {mode === 'register'
                ? 'Create your account'
                : 'Sign in to your account'}
            </h1>
            <p>{headCopy}</p>
          </div>

          <div className="role-tabs" role="tablist" aria-label="Account role">
            {ROLE_TABS.map((tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={role === tab.role}
                className={`role-tabs__btn ${role === tab.role ? 'role-tabs__btn--active' : ''}`}
                key={tab.role}
                onClick={() => switchRole(tab.role)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {mode === 'signin' ? (
            <form onSubmit={handleSubmit} noValidate>
              <div className="field">
                <label className="label" htmlFor="login-email">
                  Email address
                </label>
                <div className="input-with-icon">
                  <IconMail size={17} className="input-leading-icon" />
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
                </div>
                {errors.email && (
                  <p className="field-error">
                    <IconAlertTriangle size={14} />
                    {errors.email}
                  </p>
                )}
              </div>

              <div className="field">
                <label className="label" htmlFor="login-password">
                  Password
                </label>
                <div className="input-with-icon">
                  <IconLock size={17} className="input-leading-icon" />
                  <input
                    id="login-password"
                    className={`input ${errors.password ? 'input--error' : ''}`}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="input-icon-btn"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
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

              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                <span className="checkbox__box" aria-hidden="true" />
                <span className="checkbox__text">
                  <strong>Remember me</strong>
                  <small>
                    Stay signed in across browser restarts on this device.
                  </small>
                </span>
              </label>

              {errors.auth && (
                <div className="auth__error">
                  <IconAlertTriangle size={16} />
                  {errors.auth}
                </div>
              )}

              <button
                type="submit"
                className="btn btn--primary btn--block btn--lg"
                disabled={submitting}
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegisterSubmit} noValidate>
              <div className="field">
                <label className="label" htmlFor="register-name">
                  Full name
                </label>
                <input
                  id="register-name"
                  className={`input ${errors.fullName ? 'input--error' : ''}`}
                  type="text"
                  autoComplete="name"
                  placeholder="e.g. Ada Obi"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
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
                  <input
                    id="register-business"
                    className={`input ${errors.businessName ? 'input--error' : ''}`}
                    type="text"
                    placeholder="e.g. Fresh Foods Logistics"
                    value={businessName}
                    onChange={(event) => setBusinessName(event.target.value)}
                  />
                  {errors.businessName && (
                    <p className="field-error">
                      <IconAlertTriangle size={14} />
                      {errors.businessName}
                    </p>
                  )}
                </div>
              )}

              <div className="field">
                <label className="label" htmlFor="register-email">
                  Email address
                </label>
                <div className="input-with-icon">
                  <IconMail size={17} className="input-leading-icon" />
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
                </div>
                {errors.email && (
                  <p className="field-error">
                    <IconAlertTriangle size={14} />
                    {errors.email}
                  </p>
                )}
              </div>

              <div className="field">
                <label className="label" htmlFor="register-password">
                  Password
                </label>
                <div className="input-with-icon">
                  <IconLock size={17} className="input-leading-icon" />
                  <input
                    id="register-password"
                    className={`input ${errors.password ? 'input--error' : ''}`}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className="input-icon-btn"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
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
                className="btn btn--primary btn--block btn--lg"
              >
                <IconUserPlus size={17} />
                Create {ROLE_LABEL[role]} account
              </button>
            </form>
          )}

          <button
            type="button"
            className="auth__switch"
            onClick={() =>
              switchMode(mode === 'signin' ? 'register' : 'signin')
            }
          >
            {mode === 'signin'
              ? 'New to AZ Delivery? Create an account'
              : 'Already have an account? Sign in instead'}
          </button>
        </div>
      </main>
    </div>
  )
}
