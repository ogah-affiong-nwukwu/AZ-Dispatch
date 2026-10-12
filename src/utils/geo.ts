import type { GeoPoint } from '../types'

export const GEOFENCE_RADIUS_METERS = 50

const EARTH_RADIUS_METERS = 6_371_000

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function haversineDistanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat)
  const dLng = toRadians(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) *
      Math.cos(toRadians(b.lat)) *
      Math.sin(dLng / 2) ** 2
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(s)))
}

export function mockGpsScan(target: GeoPoint): number {
  const passes = Math.random() < 0.72
  const scale = 0.5 + Math.random()
  const jitterDegrees = (passes ? 0.00022 : 0.00075) * scale
  const reading: GeoPoint = {
    lat: target.lat + (Math.random() - 0.5) * 2 * jitterDegrees,
    lng: target.lng + (Math.random() - 0.5) * 2 * jitterDegrees,
  }
  return haversineDistanceMeters(target, reading)
}

export function mockGeocode(seed: string, base: GeoPoint): GeoPoint {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const latJitter = (((hash % 2000) / 2000) - 0.5) * 0.02
  const lngJitter = ((((hash >>> 8) % 2000) / 2000) - 0.5) * 0.02
  return {
    lat: Number((base.lat + latJitter).toFixed(5)),
    lng: Number((base.lng + lngJitter).toFixed(5)),
  }
}
