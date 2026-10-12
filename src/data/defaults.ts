import type { Address, TrackingEvent } from '../types'

export const AZ_HUB: Address = {
  label: 'AZ Hub — Ikeja',
  line1: '14 Industrial Avenue',
  city: 'Ikeja',
  state: 'Lagos',
  coordinates: { lat: 6.6018, lng: 3.3515 },
}

export const DEFAULT_PICKUP: Address = AZ_HUB

export function createWaybillNumber(): string {
  const random = Math.floor(1000 + Math.random() * 9000)
  return `AZD-${random}`
}

export function createTimelineEvent(
  title: string,
  location: string,
  description: string,
  tone: TrackingEvent['tone'] = 'info',
): TrackingEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    title,
    location,
    description,
    tone,
  }
}
