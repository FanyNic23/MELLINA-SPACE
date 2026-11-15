import mark from '../assets/brand/ahams-mark.svg?raw'
import word from '../assets/brand/ahams-word.svg?raw'

/** Marca vectorial A-HAMS (vectorizada del logo original). Hereda el color del texto. */
export function BrandMark({ className = '' }: { className?: string }) {
  return <span className={`inline-flex [&>svg]:h-full [&>svg]:w-auto ${className}`} role="img" aria-label="A-HAMS"
    dangerouslySetInnerHTML={{ __html: mark }} />
}

export function BrandWord({ className = '' }: { className?: string }) {
  return <span className={`inline-flex [&>svg]:h-full [&>svg]:w-auto ${className}`} aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: word }} />
}
