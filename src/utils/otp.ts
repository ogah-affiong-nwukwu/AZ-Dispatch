export function generateOtp(length = 6): string {
  const digits = new Uint32Array(length)
  crypto.getRandomValues(digits)
  return Array.from(digits, (digit) => digit % 10).join('')
}
