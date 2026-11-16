/** Miembro de la tripulación en el formato del asistente (diagnóstico hablado). */
export interface AssistantMember { id: string; name: string; displayStatus: 'NOMINAL' | 'ALERTA_MODERADA' | 'ALERTA_CRITICA'; [k: string]: unknown }
export interface MissionData { online: boolean; crew: AssistantMember[]; dtn: unknown }
export interface Intent { type: string; key?: string; member?: AssistantMember }

/** Diagnóstico hablado de Mellina: respuestas generadas con los datos del motor clínico (ES / EN). */
export const MissionDiagnosis: {
  ASSISTANT_NAME: string
  setLanguage(code: 'es' | 'en'): void
  readonly language: 'es' | 'en'
  loadMissionData(): Promise<MissionData>
  greeting(m: AssistantMember): string
  health(m: AssistantMember): string
  environment(m: AssistantMember): string
  ship(m: AssistantMember, dtn: unknown): string
  full(m: AssistantMember, dtn: unknown): string
  unknown(): string
  /** Respuesta de conversación (nombre, ayuda, hora…) para una intención de tipo 'chat'. */
  chat(key: string, m: AssistantMember): string
  intentFrom(transcript: string, crew: AssistantMember[]): Intent
}
