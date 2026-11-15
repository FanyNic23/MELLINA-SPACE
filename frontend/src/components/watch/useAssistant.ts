import { useCallback, useEffect, useRef, useState } from 'react'
import type { Astronaut } from '../../api/types'
import { useI18n } from '../../i18n'
import { MissionDiagnosis as D, type AssistantMember, type MissionData } from '../../lib/assistant/diagnosis'
import { HoloAvatar } from '../../lib/assistant/HoloAvatar'
import { VoiceListener } from '../../lib/assistant/listener'
import { VoiceEngine } from '../../lib/assistant/voice'

export type Topic = 'greeting' | 'health' | 'environment' | 'ship' | 'full'

const LISTENING = '\u0000listening'
const PROCESSING = '\u0000processing'
export interface LogLine { who: string; text: string; user?: boolean }

/**
 * Asistente Mellina dentro del reloj, 100% local: holograma, voz del sistema, micrófono con Whisper
 * en el Edge Core y respuestas generadas con los datos del motor clínico. Habla y escucha en el idioma
 * activo de la interfaz.
 */
export function useAssistant(current: Astronaut | null, onSelectCrew: (id: string) => void) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const avatar = useRef<HoloAvatar | null>(null)
  const voice = useRef<VoiceEngine | null>(null)
  const listener = useRef<VoiceListener | null>(null)
  const mission = useRef<MissionData>({ online: false, crew: [], dtn: null })
  const greeted = useRef(false)
  const { lang, t: { watch: t } } = useI18n()
  const [caption, setCaption] = useState<string | null>(null) // null = invitación a hablar
  const [log, setLog] = useState<LogLine[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  const [micReady, setMicReady] = useState(false)

  const member = useCallback((): AssistantMember | undefined =>
    mission.current.crew.find(m => m.id === current?.id), [current?.id])

  /** Monta el holograma sobre el canvas de la carátula (lo llama el componente al montarse). */
  const attachCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    if (canvas === canvasRef.current) return
    avatar.current?.dispose()
    avatar.current = null
    canvasRef.current = canvas
    if (!canvas) return
    try {
      avatar.current = new HoloAvatar(canvas)
    } catch (err) {
      console.error('[holograma]', err) // sin WebGL: el asistente sigue respondiendo por texto y voz
    }
  }, [])

  useEffect(() => {
    voice.current = new VoiceEngine({
      onMouth: (open, width) => avatar.current?.setMouth(open, width),
      onSentence: text => setCaption(text),
      onState: state => {
        avatar.current?.setMode(state === 'idle' ? 'idle' : state)
        setSpeaking(state === 'speaking')
        if (state === 'idle') window.setTimeout(() => setCaption(c => (listener.current?.busy ? c : null)), 2500)
      },
    })
    listener.current = new VoiceListener({
      onState: state => {
        setListening(state === 'listening')
        if (state === 'listening') { avatar.current?.setMode('listening'); setCaption(LISTENING) }
        else if (state === 'transcribing') { avatar.current?.setMode('thinking'); setCaption(PROCESSING) }
        else avatar.current?.setMode('idle')
      },
    })
    const setup = () => listener.current!.init().then(engine => setMicReady(Boolean(engine)))
    void setup()
    const t = window.setInterval(setup, 30_000) // detecta cuando el Edge Core arranca o se detiene
    return () => {
      window.clearInterval(t)
      voice.current?.dispose()
      listener.current?.cancel()
      avatar.current?.dispose()
    }
  }, [])

  // Idioma de la voz, del reconocimiento (Whisper) y de las respuestas.
  useEffect(() => {
    D.setLanguage(lang)
    voice.current?.setLanguage(lang)
    listener.current?.setLanguage(lang)
  }, [lang])

  useEffect(() => {
    void D.loadMissionData().then(m => { mission.current = m })
    const m = member()
    if (m) avatar.current?.setStatus(m.displayStatus)
    if (current) avatar.current?.setStatus(current.status)
  }, [current, member])

  const say = useCallback((text: string) => {
    setLog(l => [{ who: D.ASSISTANT_NAME.toUpperCase(), text }, ...l])
    return voice.current?.speak(text)
  }, [])

  const answer = useCallback(async (topic: Topic) => {
    avatar.current?.setMode('thinking')
    mission.current = await D.loadMissionData()
    const m = member()
    if (!m) return
    const texts: Record<Topic, () => string> = {
      greeting: () => D.greeting(m), health: () => D.health(m), environment: () => D.environment(m),
      ship: () => D.ship(m, mission.current.dtn), full: () => D.full(m, mission.current.dtn),
    }
    await say((texts[topic] ?? D.unknown)())
  }, [member, say])

  const tap = useCallback(() => {
    if (speaking) return voice.current?.stop()
    void answer(greeted.current ? 'health' : 'greeting')
    greeted.current = true
  }, [answer, speaking])

  const talk = useCallback(async () => {
    const l = listener.current!
    if (l.busy) return l.stop()
    voice.current?.stop()
    if (!l.engine) await l.init()
    try {
      const said = await l.listen()
      if (!said) return setCaption(t.notHeard)
      setLog(lg => [{ who: t.you, text: said, user: true }, ...lg])
      const intent = D.intentFrom(said, mission.current.crew)
      if (intent.member && intent.member.id !== current?.id) onSelectCrew(intent.member.id)
      if (intent.type === 'select' && intent.member) void say(D.greeting(intent.member))
      else if (intent.type === 'stop') voice.current?.stop()
      else void answer(intent.type as Topic)
    } catch (err) {
      setCaption((err as Error).name === 'NotAllowedError' ? t.micPermission : t.voiceFailed)
    }
  }, [answer, current, onSelectCrew, say, t])

  const lookAt = useCallback((x: number, y: number) => avatar.current?.lookAt(x, y), [])
  const stop = useCallback(() => voice.current?.stop(), [])

  // Estados del micrófono: marcadores que se traducen al pintar (el listener vive fuera de React).
  const shown = caption === LISTENING ? t.listening : caption === PROCESSING ? t.processing : caption ?? t.idle(D.ASSISTANT_NAME)
  return { attachCanvas, caption: shown, log, speaking, listening, micReady, answer, tap, talk, lookAt, stop }
}

export type AssistantApi = ReturnType<typeof useAssistant>
