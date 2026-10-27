import styles from './visual/theme.css?raw'
import runtime from './visual/runtime.js?raw'
import explorer from './visual/explorer.js?raw'
import react from 'virtual:sophon-visual-react'

export const VISUAL_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"

export function visualDocument(source: string, id: string): string {
  const scripts = [runtime, explorer, react].join('\n;\n').replace(/<\/script/gi, '<\\/script')
  const theme = `<style>${styles}</style><script>${scripts}</script>`
  const bridge = `<script>(()=>{
    const id=${JSON.stringify(id)};
    const post=(type,value)=>parent.postMessage({channel:'sophon-visual',id,type,value},'*');
    window.sophon=Object.freeze({...window.sophon,followUp(question){if(typeof question==='string'&&navigator.userActivation.isActive)post('follow-up',question.slice(0,2000))}});
    addEventListener('error',event=>post('error',String(event.message).slice(0,500)));
    addEventListener('unhandledrejection',event=>post('error',String(event.reason).slice(0,500)));
    addEventListener('DOMContentLoaded',()=>{
      let last=0;let queued=false;
      const measure=()=>{queued=false;const height=Math.ceil(document.body.getBoundingClientRect().height)+2;if(height!==last){last=height;post('height',height)}};
      const schedule=()=>{if(!queued){queued=true;requestAnimationFrame(measure)}};
      new ResizeObserver(schedule).observe(document.body);
      addEventListener('resize',schedule);schedule();
      document.addEventListener('click',event=>{const link=event.target.closest?.('a');if(link)event.preventDefault()});
      post('ready',document.title.slice(0,100)||'Interactive visual');
    });
  })()</script>`
  const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${theme}${bridge}`
  if (/<html[\s>]/i.test(source)) {
    if (!/<\/html\s*>\s*$/i.test(source))
      throw new Error(
        'The model stopped before finishing this visual. Ask it to complete the HTML document.'
      )
    if (/<head[\s>]/i.test(source)) return source.replace(/<head\b[^>]*>/i, (tag) => tag + head)
    return source.replace(/<html\b[^>]*>/i, (tag) => tag + '<head>' + head + '</head>')
  }
  return `<!doctype html><html><head>${head}</head><body>${source}</body></html>`
}
