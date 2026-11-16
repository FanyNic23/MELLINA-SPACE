import {
  ArrowCounterClockwise, ArrowRight, Barbell, Bed, Brain, Broadcast, Camera, CheckCircle, CircleNotch, ClipboardText, CloudFog,
  CornersIn, CornersOut, Cpu, Crosshair, Drop, Fire, Gauge, GlobeHemisphereWest, Heartbeat, Lightning, Medal,
  Microphone, MoonStars, PaperPlaneTilt, Planet, Play, Pulse, Radioactive, Robot, RocketLaunch, Scan, ShieldWarning,
  SlidersHorizontal, Smiley, SmileyMeh, SmileyNervous, SmileySad, Star, Stethoscope, Stop, Thermometer, TreeEvergreen,
  Trophy, UserFocus, UsersThree, Warning, WarningOctagon, Watch, Wind, X, XCircle, type Icon as PhosphorIcon,
} from '@phosphor-icons/react'

// Iconos sólidos (Phosphor "fill", MIT), empaquetados localmente. Nunca emojis.
const ICONS: Record<string, PhosphorIcon> = {
  'arrow-counter-clockwise': ArrowCounterClockwise, 'arrow-right': ArrowRight, barbell: Barbell, bed: Bed, brain: Brain,
  broadcast: Broadcast, camera: Camera, 'check-circle': CheckCircle, 'circle-notch': CircleNotch, 'clipboard-text': ClipboardText, 'cloud-fog': CloudFog,
  'corners-in': CornersIn, 'corners-out': CornersOut, cpu: Cpu, crosshair: Crosshair, drop: Drop, fire: Fire, gauge: Gauge,
  'globe-hemisphere-west': GlobeHemisphereWest, heartbeat: Heartbeat, lightning: Lightning, medal: Medal,
  microphone: Microphone, 'moon-stars': MoonStars, 'paper-plane-tilt': PaperPlaneTilt, planet: Planet, play: Play,
  pulse: Pulse, radioactive: Radioactive, robot: Robot, 'rocket-launch': RocketLaunch, scan: Scan,
  'shield-warning': ShieldWarning, 'sliders-horizontal': SlidersHorizontal, smiley: Smiley, 'smiley-meh': SmileyMeh,
  'smiley-nervous': SmileyNervous, 'smiley-sad': SmileySad, star: Star, stethoscope: Stethoscope, stop: Stop,
  thermometer: Thermometer, 'tree-evergreen': TreeEvergreen, trophy: Trophy, 'user-focus': UserFocus,
  'users-three': UsersThree, warning: Warning, 'warning-octagon': WarningOctagon, watch: Watch, wind: Wind, x: X,
  'x-circle': XCircle,
}

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 16, className = '' }: { name: string; size?: number; className?: string }) {
  const C = ICONS[name] ?? Warning
  return <C size={size} weight="fill" className={`shrink-0 ${className}`} aria-hidden="true" />
}
