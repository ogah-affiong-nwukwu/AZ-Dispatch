import { useEffect } from 'react'
import type { ToastMessage } from '../types'
import { IconAlertTriangle, IconCheckCircle, IconInfo } from './Icons'

interface ToastProps {
  message: ToastMessage | null
  onDismiss: () => void
}

export function Toast({ message, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message) return
    const timer = window.setTimeout(onDismiss, 3400)
    return () => window.clearTimeout(timer)
  }, [message, onDismiss])

  if (!message) return null

  const Icon =
    message.tone === 'success'
      ? IconCheckCircle
      : message.tone === 'error'
        ? IconAlertTriangle
        : IconInfo

  return (
    <div className={`toast toast--${message.tone}`} role="status">
      <Icon size={18} className="toast__icon" />
      <span>{message.text}</span>
    </div>
  )
}
