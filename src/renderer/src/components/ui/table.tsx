import { cn } from '@/lib/utils'
import { ScrollArea } from './scroll-area'

function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<'table'> & { containerClassName?: string }): React.JSX.Element {
  return (
    <ScrollArea
      data-slot="table-container"
      orientation="horizontal"
      className={cn('w-full', containerClassName)}
    >
      <table
        data-slot="table"
        className={cn('w-full caption-bottom text-left text-sm', className)}
        {...props}
      />
    </ScrollArea>
  )
}
function TableHeader({ className, ...props }: React.ComponentProps<'thead'>): React.JSX.Element {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />
}
function TableBody({ className, ...props }: React.ComponentProps<'tbody'>): React.JSX.Element {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}
function TableRow({ className, ...props }: React.ComponentProps<'tr'>): React.JSX.Element {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b transition-colors hover:bg-muted/30 data-[state=selected]:bg-muted',
        className
      )}
      {...props}
    />
  )
}
function TableHead({ className, ...props }: React.ComponentProps<'th'>): React.JSX.Element {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-10 px-2 text-left align-middle font-medium text-muted-foreground',
        className
      )}
      {...props}
    />
  )
}
function TableCell({ className, ...props }: React.ComponentProps<'td'>): React.JSX.Element {
  return <td data-slot="table-cell" className={cn('p-2 align-middle', className)} {...props} />
}
export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
