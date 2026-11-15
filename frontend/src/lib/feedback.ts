// Sonidos (Web Audio) y vibración del reloj, generados localmente.
let ctx: AudioContext | null = null

export function beep(freq = 880, duration = 0.08, type: OscillatorType = 'sine') {
  try {
    ctx ??= new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, ctx.currentTime)
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + duration)
  } catch { /* audio no disponible */ }
}

/** El navegador solo permite vibrar después de que el usuario haya tocado la pantalla. */
export function haptic(pattern: number[] = [80]) {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation
  if (navigator.vibrate && (!ua || ua.hasBeenActive)) navigator.vibrate(pattern)
}
