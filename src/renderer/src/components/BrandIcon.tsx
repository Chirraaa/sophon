import icon from '../../../../resources/icon-64.png'
import { cn } from '@/lib/utils'

export function BrandIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <img
      src={icon}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={32}
      height={32}
      className={cn('size-8 shrink-0 object-contain', className)}
    />
  )
}
