import { useEffect, useState } from 'react'
import { Monitor } from 'lucide-react'
import { Notice, PillButton, Row, Section } from './controls'
const gigabytes = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1) + ' GB'
export function HardwareTab(): React.JSX.Element {
  const [info, setInfo] = useState<HardwareInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let alive = true
    void window.api
      .hardware()
      .then((value) => {
        if (alive) setInfo(value)
      })
      .catch((error: Error) => {
        if (alive) setError(error.message)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [revision])
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <PillButton
          disabled={loading}
          onClick={() => {
            setLoading(true)
            setError(null)
            setRevision((value) => value + 1)
          }}
        >
          {loading ? 'Refreshing…' : 'Refresh hardware'}
        </PillButton>
      </div>
      {error && <Notice tone="warn">{error}</Notice>}
      {info && (
        <>
          <Section title="This computer">
            <Row label="Operating system">
              <span className="text-xs text-muted-foreground">{info.os}</span>
            </Row>
            <Row label="Processor" hint={info.logicalCores + ' logical processors'}>
              <span className="text-xs text-muted-foreground">{info.cpu}</span>
            </Row>
            <Row label="Memory" hint={gigabytes(info.memoryFree) + ' currently available'}>
              <span className="text-xs text-muted-foreground">{gigabytes(info.memoryTotal)}</span>
            </Row>
            <Row label="Graphics" stack>
              <div className="space-y-1 text-xs text-muted-foreground">
                {info.graphics.length
                  ? info.graphics.map((name, index) => <p key={index}>{name}</p>)
                  : 'Graphics information is unavailable.'}
              </div>
            </Row>
          </Section>
          <Section title="Displays">
            {!info.displays.length && (
              <p className="text-xs text-muted-foreground">
                No displays reported. Refresh hardware to try again.
              </p>
            )}
            {info.displays.map((display, index) => (
              <Row
                key={index}
                label={display.name + (display.primary ? ' · Primary' : '')}
                hint={Math.round(display.scale * 100) + '% scaling'}
              >
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Monitor className="size-4" />
                  {display.width} × {display.height} · {Math.round(display.refreshRate)} Hz
                </span>
              </Row>
            ))}
          </Section>
        </>
      )}
    </div>
  )
}
