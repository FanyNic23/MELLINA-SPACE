// Avisos breves en pantalla (sustituyen a alert()).
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

const ToastContext = createContext<(text: string) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState('')
  const [on, setOn] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const toast = useCallback((t: string) => {
    setText(t)
    setOn(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOn(false), 2800)
  }, [])
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div role="status" aria-live="polite"
        className={`pointer-events-none fixed left-1/2 top-[84px] z-[95] -translate-x-1/2 rounded-xl bg-space-700 px-4 py-2.5 text-[13px] font-semibold text-slate-200 shadow-[0_14px_40px_rgba(0,0,0,0.6)] transition duration-200 ${on ? 'opacity-100' : '-translate-y-3 opacity-0'}`}>
        {text}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
