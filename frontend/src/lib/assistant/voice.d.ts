import type { AvatarMode } from './HoloAvatar'

/** Voz del asistente con las voces instaladas en el sistema (sin servicios externos). */
export class VoiceEngine {
  constructor(opts: { onMouth?: (open: number, width: number) => void; onState?: (s: AvatarMode | 'idle') => void; onSentence?: (s: string) => void })
  readonly supported: boolean
  speak(text: string): Promise<void>
  stop(): void
  setLanguage(code: 'es' | 'en'): void
  dispose(): void
}
