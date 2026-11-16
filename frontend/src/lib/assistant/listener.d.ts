/** Micrófono: graba hasta detectar silencio y lo transcribe Whisper local en el Edge Core. */
export class VoiceListener {
  constructor(opts: { onState?: (s: 'listening' | 'transcribing' | 'idle') => void })
  engine: 'server' | null
  busy: boolean
  init(): Promise<'server' | null>
  listen(): Promise<string>
  stop(): void
  cancel(): void
  /** Idioma detectado por Whisper en la última orden. */
  language: string | null
}
