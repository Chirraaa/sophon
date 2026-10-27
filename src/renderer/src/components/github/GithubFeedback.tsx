import { useId, useState, type ComponentProps } from 'react'
import { CircleAlert } from 'lucide-react'
import { friendlyError } from './data'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'

export function GithubError({ error }: { error: unknown }): React.JSX.Element {
  return (
    <Alert variant="destructive">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      <AlertTitle>Something needs your attention</AlertTitle>
      <AlertDescription className="min-w-0 whitespace-pre-wrap break-words">
        {friendlyError(error)}
      </AlertDescription>
    </Alert>
  )
}

export function GithubForm({
  children,
  onSubmit,
  ...props
}: ComponentProps<'form'>): React.JSX.Element {
  const [error, setError] = useState('')
  const id = useId()
  return (
    <form
      {...props}
      noValidate
      onInput={(event) => {
        setError('')
        const field = event.target as HTMLInputElement
        field.removeAttribute('aria-invalid')
        field.removeAttribute('aria-describedby')
      }}
      onSubmit={(event) => {
        const fields = Array.from(event.currentTarget.elements).filter(
          (field): field is HTMLInputElement | HTMLTextAreaElement =>
            field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
        )
        const invalid = fields.find(
          (field) =>
            !field.disabled && ((field.required && !field.value.trim()) || !field.validity.valid)
        )
        if (invalid) {
          event.preventDefault()
          const name = invalid.getAttribute('aria-label') || 'this field'
          setError(
            invalid.validity.patternMismatch
              ? 'Enter a repository as owner/name, using a repository owned by the selected account.'
              : `Enter ${name.toLowerCase()} to continue.`
          )
          invalid.setAttribute('aria-invalid', 'true')
          invalid.setAttribute('aria-describedby', id)
          invalid.focus()
          return
        }
        setError('')
        onSubmit?.(event)
      }}
    >
      {children}
      {error && (
        <p id={id} role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
