import { useLayoutEffect } from 'react'

export function useCompactBackdrop(): void {
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.compactBackdrop = 'true'
    let frame = 0
    const update = (): void => {
      const command = document
        .querySelector<HTMLElement>('[data-compact-size]')
        ?.getBoundingClientRect()
      if (command) {
        root.style.setProperty('--popup-center-x', `${command.left + command.width / 2}px`)
        root.style.setProperty('--popup-max-width', `${command.width - 24}px`)
      }
      const paths: string[] = []
      for (const panel of document.querySelectorAll<HTMLElement>(
        '[data-compact-size], [data-compact-context] .glass-solid'
      )) {
        const box = panel.getBoundingClientRect()
        let left = Math.max(0, box.left),
          top = Math.max(0, box.top)
        let right = Math.min(innerWidth, box.right),
          bottom = Math.min(innerHeight, box.bottom)

        const context = panel.closest('[data-compact-context]')
        if (context) {
          const clip = context.getBoundingClientRect()
          left = Math.max(left, clip.left)
          top = Math.max(top, clip.top)
          right = Math.min(right, clip.right)
          bottom = Math.min(bottom, clip.bottom)
        }
        if (right <= left || bottom <= top) continue
        const clipped =
          left !== box.left || top !== box.top || right !== box.right || bottom !== box.bottom
        const radius = clipped
          ? 0
          : Math.min(
              parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0,
              (right - left) / 2,
              (bottom - top) / 2
            )
        paths.push(
          `M${left + radius},${top}H${right - radius}Q${right},${top} ${right},${top + radius}V${bottom - radius}Q${right},${bottom} ${right - radius},${bottom}H${left + radius}Q${left},${bottom} ${left},${bottom - radius}V${top + radius}Q${left},${top} ${left + radius},${top}Z`
        )
      }
      const value = paths.length ? `path('${paths.join(' ')}')` : 'inset(50%)'
      if (root.style.getPropertyValue('--compact-backdrop-clip') !== value)
        root.style.setProperty('--compact-backdrop-clip', value)
    }
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(schedule)
    const observe = (): void => {
      resize.disconnect()
      for (const element of document.querySelectorAll(
        '[data-compact-size], [data-compact-context], [data-compact-context] .glass-solid'
      ))
        resize.observe(element)
      schedule()
    }
    const mutations = new MutationObserver(observe)
    mutations.observe(document.getElementById('root')!, { childList: true, subtree: true })
    observe()
    update()
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    document.addEventListener('animationend', schedule, true)
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      document.removeEventListener('animationend', schedule, true)
      delete root.dataset.compactBackdrop
      root.style.removeProperty('--compact-backdrop-clip')
      root.style.removeProperty('--popup-center-x')
      root.style.removeProperty('--popup-max-width')
      root.style.removeProperty('--popup-max-height')
    }
  }, [])
}
