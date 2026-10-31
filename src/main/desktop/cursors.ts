import { BrowserWindow, screen } from 'electron'
import { getSettings, onSettingsChange } from '../settings'
import { fullscreenApp } from '../services/fullscreen'
import { onRunFinished, type RunContext } from '../security/run-manager'
import type { Point } from '../../shared/pointer-path'

// Each agent that uses the desktop gets its own labelled cursor in its colour, drawn on a
// transparent, click-through overlay that screenshots never include. The cursor glides to
// where the agent acts: along the same path as the real pointer for clicks, and on its own
// for accessibility actions, which never move the real pointer. Several agents' cursors
// can be on screen at once.

type CursorState = 'active' | 'waiting' | 'idle'
type Cursor = {
  id: string
  label: string
  color: string
  display?: number
  at?: Point
}
type Overlay = { window: BrowserWindow; ready: boolean; queue: unknown[]; bounds: Electron.Rectangle }

const cursors = new Map<string, Cursor>()
const overlays = new Map<number, Overlay>()
let closeTimer: NodeJS.Timeout | undefined
let watching = false

const enabled = (): boolean => getSettings().agents?.cursors !== false
const reducedMotion = (): boolean => getSettings().motion === 'reduced'

function identity(run: RunContext): Cursor {
  const id = run.agent?.chatId ?? run.id
  let cursor = cursors.get(id)
  if (!cursor) {
    cursor = {
      id,
      label: (run.agent?.title ?? 'Sophon').slice(0, 28),
      color: run.agent?.color ?? '#7c6cf2'
    }
    cursors.set(id, cursor)
  }
  return cursor
}

// Physical screen pixels to the overlay's local DIP coordinates on that display.
function locate(point: Point): { display: Electron.Display; local: Point } {
  const dip = screen.screenToDipPoint(point)
  const display = screen.getDisplayNearestPoint(dip)
  return { display, local: { x: dip.x - display.bounds.x, y: dip.y - display.bounds.y } }
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;pointer-events:none;font:600 11px/1.2 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}
.c{position:fixed;left:0;top:0;will-change:transform;transition:opacity .25s ease}
.c svg{display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}
.c .tag{position:absolute;left:16px;top:18px;padding:3px 7px;border-radius:7px;color:#fff;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.35);display:flex;gap:5px;align-items:center}
.c.idle{opacity:.55}.c.waiting{opacity:.7}.c.waiting .tag::after{content:"waiting";opacity:.8;font-weight:500}
.c .dots{display:none;gap:2px}.c.typing .dots{display:inline-flex}
.c .dots i{width:3px;height:3px;border-radius:50%;background:#fff;opacity:.4;animation:b 1s infinite}
.c .dots i:nth-child(2){animation-delay:.15s}.c .dots i:nth-child(3){animation-delay:.3s}
@keyframes b{50%{opacity:1}}
.r{position:fixed;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;border:2px solid;animation:r .45s ease-out forwards}
@keyframes r{from{transform:scale(.3);opacity:.9}to{transform:scale(1.6);opacity:0}}
.still .r,.still .dots i{animation:none}
</style></head><body><script>
(function(){
  var items = {};
  var raf = 0;
  function ease(t){ return t*t*t*(10-15*t+6*t*t) }
  function point(a, t){
    var s = ease(Math.min(1, Math.max(0, t)));
    var dx = a.tx - a.fx, dy = a.ty - a.fy;
    var cx = (a.fx + a.tx)/2 - dy*a.curve, cy = (a.fy + a.ty)/2 + dx*a.curve;
    var p = (1-s)*(1-s), q = 2*(1-s)*s, r = s*s;
    return { x: p*a.fx + q*cx + r*a.tx, y: p*a.fy + q*cy + r*a.ty };
  }
  function place(c){ c.el.style.transform = 'translate3d(' + (c.x-2) + 'px,' + (c.y-2) + 'px,0)'; }
  function tick(now){
    raf = 0;
    var busy = false;
    for (var id in items){
      var c = items[id];
      if (!c.anim) continue;
      var t = c.anim.dur ? (now - c.anim.start) / c.anim.dur : 1;
      var p = point(c.anim, t);
      c.x = p.x; c.y = p.y; place(c);
      if (t >= 1) c.anim = null; else busy = true;
    }
    if (busy) raf = requestAnimationFrame(tick);
  }
  function make(cmd){
    var el = document.createElement('div');
    el.className = 'c idle';
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '22'); svg.setAttribute('height', '24'); svg.setAttribute('viewBox', '0 0 22 24');
    var path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M2 2 L2 19 L6.8 14.6 L10.2 22 L13.4 20.6 L10.1 13.4 L16.6 13.2 Z');
    path.setAttribute('stroke', '#fff'); path.setAttribute('stroke-width', '1.6'); path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    var tag = document.createElement('span'); tag.className = 'tag';
    var label = document.createElement('span');
    var dots = document.createElement('span'); dots.className = 'dots';
    dots.appendChild(document.createElement('i')); dots.appendChild(document.createElement('i')); dots.appendChild(document.createElement('i'));
    tag.appendChild(label); tag.appendChild(dots);
    el.appendChild(svg); el.appendChild(tag);
    document.body.appendChild(el);
    return { el: el, path: path, tag: tag, label: label, x: cmd.x, y: cmd.y, anim: null };
  }
  function style(c, cmd){
    c.path.setAttribute('fill', cmd.color);
    c.tag.style.background = cmd.color;
    c.label.textContent = cmd.label;
  }
  window.cursors = { apply: function(cmds){
    document.body.className = cmds.still ? 'still' : '';
    cmds.list.forEach(function(cmd){
      var c = items[cmd.id];
      if (cmd.op === 'remove'){
        if (!c) return;
        c.el.style.opacity = '0';
        delete items[cmd.id];
        setTimeout(function(){ c.el.remove(); }, 260);
        return;
      }
      if (!c){ c = items[cmd.id] = make(cmd); place(c); }
      if (cmd.color) style(c, cmd);
      if (cmd.op === 'move'){
        if (!cmd.dur){ c.anim = null; c.x = cmd.x; c.y = cmd.y; place(c); }
        else {
          c.anim = { fx: c.x, fy: c.y, tx: cmd.x, ty: cmd.y, curve: cmd.curve || 0, dur: cmd.dur, start: performance.now() };
          if (!raf) raf = requestAnimationFrame(tick);
        }
      } else if (cmd.op === 'pulse'){
        var r = document.createElement('div');
        r.className = 'r'; r.style.borderColor = c.path.getAttribute('fill');
        r.style.left = cmd.x + 'px'; r.style.top = cmd.y + 'px';
        document.body.appendChild(r);
        setTimeout(function(){ r.remove(); }, 500);
      }
      if (cmd.state){
        c.el.className = 'c ' + cmd.state + (cmd.typing ? ' typing' : '');
      }
    });
  }};
})();
</script></body></html>`

function closeAll(): void {
  for (const overlay of overlays.values())
    if (!overlay.window.isDestroyed()) overlay.window.destroy()
  overlays.clear()
  for (const cursor of cursors.values()) {
    delete cursor.display
  }
}

function watch(): void {
  if (watching) return
  watching = true
  screen.on('display-removed', closeAll)
  screen.on('display-metrics-changed', closeAll)
  onSettingsChange((settings) => {
    if (settings.agents?.cursors === false) closeAll()
  })
}

function overlayFor(display: Electron.Display): Overlay | null {
  // A topmost window would throw an exclusive fullscreen game out of its display mode.
  const game = fullscreenApp()
  if (game?.exclusive && game.displayId === display.id) return null
  const existing = overlays.get(display.id)
  if (existing && !existing.window.isDestroyed()) return existing
  watch()
  const window = new BrowserWindow({
    ...display.bounds,
    title: 'Sophon agent cursors',
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    focusable: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      backgroundThrottling: false
    }
  })
  window.setIgnoreMouseEvents(true)
  window.setAlwaysOnTop(true, 'screen-saver')
  // Screenshots and the settle probe must never see the cursors.
  window.setContentProtection(true)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  const overlay: Overlay = { window, ready: false, queue: [], bounds: display.bounds }
  overlays.set(display.id, overlay)
  const drop = (): void => {
    if (overlays.get(display.id) === overlay) overlays.delete(display.id)
    for (const cursor of cursors.values()) if (cursor.display === display.id) delete cursor.display
  }
  window.on('closed', drop)
  window.webContents.on('render-process-gone', () => {
    drop()
    if (!window.isDestroyed()) window.destroy()
  })
  window.webContents.once('did-finish-load', () => {
    overlay.ready = true
    flush(overlay)
    if (!window.isDestroyed()) window.showInactive()
  })
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`).catch(drop)
  return overlay
}

function flush(overlay: Overlay): void {
  if (!overlay.ready || !overlay.queue.length || overlay.window.isDestroyed()) return
  const list = overlay.queue.splice(0)
  void overlay.window.webContents
    .executeJavaScript(
      `window.cursors&&window.cursors.apply(${JSON.stringify({ still: reducedMotion(), list })})`
    )
    .catch(() => {})
}

function send(display: number, command: Record<string, unknown>): void {
  const overlay = overlays.get(display)
  if (!overlay || overlay.window.isDestroyed()) return
  overlay.queue.push(command)
  flush(overlay)
}

function scheduleClose(): void {
  clearTimeout(closeTimer)
  if (cursors.size) return
  closeTimer = setTimeout(() => {
    if (!cursors.size) closeAll()
  }, 800)
}

// Moves a run's cursor to a physical screen point over `duration` ms along `curve`.
export function cursorMove(
  run: RunContext,
  to: Point,
  options: { duration?: number; curve?: number; state?: CursorState; typing?: boolean } = {}
): void {
  if (!enabled()) return
  try {
    clearTimeout(closeTimer)
    const cursor = identity(run)
    const { display, local } = locate(to)
    const overlay = overlayFor(display)
    if (!overlay) return
    // Crossing to another monitor: leave the old one and appear at the destination.
    if (cursor.display !== undefined && cursor.display !== display.id)
      send(cursor.display, { op: 'remove', id: cursor.id })
    const fresh = cursor.display !== display.id
    cursor.display = display.id
    cursor.at = to
    send(display.id, {
      op: 'move',
      id: cursor.id,
      label: cursor.label,
      color: cursor.color,
      x: local.x,
      y: local.y,
      dur: fresh || reducedMotion() ? 0 : Math.max(0, options.duration ?? 0),
      curve: options.curve ?? 0,
      state: options.state ?? 'active',
      typing: options.typing === true
    })
  } catch {
    // Cursors are a courtesy; a display change mid-move must never fail the action.
  }
}

// A click ripple at the cursor's position.
export function cursorPulse(run: RunContext): void {
  const cursor = cursors.get(run.agent?.chatId ?? run.id)
  if (!enabled() || cursor?.display === undefined || !cursor.at) return
  try {
    const { local } = locate(cursor.at)
    send(cursor.display, { op: 'pulse', id: cursor.id, x: local.x, y: local.y })
  } catch {
    /* Courtesy only. */
  }
}

// Shows whether the agent is acting, waiting for its turn at the desktop, or idle.
export function cursorState(run: RunContext, state: CursorState, typing = false): void {
  const cursor = cursors.get(run.agent?.chatId ?? run.id)
  if (!enabled() || cursor?.display === undefined) return
  send(cursor.display, { op: 'state', id: cursor.id, state, typing })
}

export function cursorRemove(run: RunContext): void {
  const id = run.agent?.chatId ?? run.id
  const cursor = cursors.get(id)
  if (!cursor) return
  cursors.delete(id)
  if (cursor.display !== undefined) send(cursor.display, { op: 'remove', id })
  scheduleClose()
}

// Where the run's cursor was last drawn, for starting its next glide.
export const cursorPosition = (run: RunContext): Point | undefined =>
  cursors.get(run.agent?.chatId ?? run.id)?.at

onRunFinished(cursorRemove)
