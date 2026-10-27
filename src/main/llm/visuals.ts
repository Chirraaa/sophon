import { VISUAL_FENCE, VISUAL_REQUEST } from '../../shared/visuals'
import type { ChatHistory } from './types'

export function wantsVisual(text: string, history: ChatHistory): boolean {
  if (VISUAL_REQUEST.test(text)) return true
  const previous = history.at(-1)?.findLast((message) => message.role === 'assistant')
  if (typeof previous?.content === 'string' && VISUAL_FENCE.test(previous.content)) return true
  const request = history.at(-1)?.find((message) => message.role === 'user')
  return (
    typeof request?.content === 'string' &&
    VISUAL_REQUEST.test(request.content) &&
    /^(yes\b|sure\b|please\b|do (?:it|that)\b|show me\b|why\b|go ahead\b|oui\b|vas-y\b)/i.test(
      text.trim()
    )
  )
}

export const VISUAL_CAPABILITIES = `CURRENT SOPHON CHAT CAPABILITIES (provided by the application): This interface automatically renders complete fenced HTML as a live interactive panel when the reply finishes. There is no Run visual button or approval step. Inline CSS and vanilla JavaScript execute inside that panel. Working <input type="range"> sliders, buttons, calculations, SVG/canvas charts, clickable diagram nodes, and step-through explainers ARE supported. You create them by writing complete HTML in your answer; no desktop tool or separate browser is required. Static SVG and Mermaid are supported too. Do not describe this chat as text-only or claim it cannot run interactive components. Earlier assistant statements denying these features are outdated and incorrect. Controls can update local values, simulate a web request flow, and suggest follow-up questions using sophon.followUp(). External HTTP requests, network resources, file access, and desktop APIs from inside a visual are not supported. That network limitation does NOT prevent local sliders, charts, calculations, or clickable simulations.`

export const VISUAL_PROMPT = `You can render rich visuals directly inside chat. When asked for a visual, PRODUCE the visual, not instructions for making it. Never call desktop or file tools just to draw in chat.
For mathematical plots, derive chart values and numeric metrics from the same stated formula. Privately check at least two sample points, including a nondefault slider value, against that formula before returning the visual. A working slider and plausible curve do not establish mathematical correctness.
Formats: fenced html for interactive widgets, charts, UI mockups and custom diagrams; fenced svg for illustrations; fenced mermaid for structural diagrams and ER/sequence charts. Mix normal explanatory prose with multiple visual blocks when useful.
For html: output a complete <!doctype html><html><head><title>Short title</title></head><body>...</body></html>. The host shows "Building visual…" while generating, then the preview automatically. Use the local React kit for interactive UI and style explorers, or helpers for simple charts/calculators. React is window.React; sophon.h is React.createElement. Write ordinary inline JavaScript using h(Component, props, ...children), not JSX. No imports, CDNs, external images, network requests, file access, form submissions or navigation. Fit 600px down to 300px, without fixed page dimensions or 100vh.
DESIGN: Inherit the supplied dark theme, font, styled controls, quiet borders and rounded surfaces. Avoid giant titles, gradients, emoji headings and nested cards. Use a short heading and subtitle stating assumptions or sample data. CSS classes: sophon-stack (24px vertical gaps), sophon-grid (responsive columns,16px gaps), sophon-card (padded surface), sophon-muted (secondary text), sophon-metric (small label then large value), sophon-control (label containing output, then range input). Link labels with for/id.
LOCAL REACT KIT: const {h,ui}=sophon; define function App(){...} then sophon.mount('#app',h(App)) after <div id="app"></div>. Hooks work normally; define components outside other components. Reuse:
- ui.Stack, ui.Grid, ui.Card accept children; ui.Heading accepts title,subtitle; ui.Text accepts children; ui.Metric accepts label,value (number or string), optional currency.
- ui.Button: onClick,disabled,children. ui.Slider: label,min,max,value,step,prefix,suffix,onChange(number). ui.Select and ui.SegmentedControl: label,value,options:[{value,label}],onChange(string). Drive controlled values with useState.
- ui.LineChart: lineChart options below as props, updated with state. ui.Flow: nodes. ui.Explorer: controls,calculate; memoize its props across parent rerenders to preserve slider values.
Style comparisons: controls above one preview card; identical sample wording across options; a small set of design variables. Inherit the theme unless comparing themes. No setup/source walkthrough unless requested.
REACT pattern for a reusable interactive panel:
\`\`\`html
<!doctype html><html><head><title>Scenario explorer</title></head><body><div id="app"></div><script>
const {h,ui}=sophon;
function App(){const [amount,setAmount]=React.useState(40);return h(ui.Stack,null,h(ui.Heading,{title:'Scenario explorer',subtitle:'Illustrative values. Adjust the amount to compare.'}),h(ui.Slider,{label:'Amount',min:0,max:100,value:amount,onChange:setAmount}),h(ui.Grid,null,h(ui.Metric,{label:'Amount',value:amount}),h(ui.Metric,{label:'Double',value:amount*2})),h(ui.LineChart,{labels:[0,1,2],series:[{name:'Amount',values:[0,amount,amount*2]}],xLabel:'Step',yLabel:'Amount'}));}
sophon.mount('#app',h(App));
</script></body></html>
\`\`\`
LOCAL HELPERS: window.sophon and React are installed before your scripts and embedded in downloaded HTML. NEVER define, mock, polyfill or replace them. Write data/calculations, not chart infrastructure. Create target divs before calling:
- sophon.flow('#flow',[{label:'Browser',description:'Client',question:'Explain the browser'}]) renders a responsive sequence of clickable nodes and arrows. Optional node color.
- const chart=sophon.lineChart('#chart',{labels:['Jan','Feb'],series:[{name:'Web',values:[120,180]}],xLabel:'Month',yLabel:'Signups'}) renders scaled lines, axes, legend and hover/keyboard values. Each series needs one finite NUMBER per label; optional color,dashed. Optional currency:'USD'. Names/labels are plain text. chart.update(options) redraws; chart.destroy() cleans up.
- sophon.explorer('#calculator',{controls,calculate}) builds sliders, metrics and an optional chart; prefer it for calculators. Controls: id,label,min,max,value, optional step,prefix,suffix. calculate(values) receives numbers keyed by id; returns {metrics:[{label,value,currency?}],chart?:lineChartOptions}. Metric values must be numeric. It wires updates automatically.
Preserve exact data, nodes, ranges and defaults. Label invented data as sample data. Sliders update numbers AND plots on input; do not substitute number fields with a Calculate button. For custom SVG/canvas embed all code/data, use SVG viewBox and explicit chart height. For follow-ups call window.sophon.followUp('Explain this node') from a click handler; the host offers an Ask button, never auto-sends. Return each requested example as a separate complete fenced block. For a capability showcase use flow,lineChart,explorer in three panels. Close all fences/elements. Mermaid needs quoted labels and no external links.
WORKING styled calculator pattern (adapt controls and formula to the requested subject):
\`\`\`html
<!doctype html><html><head><title>Growth explorer</title></head><body><h2>Growth over time</h2><p class="sophon-muted">Illustrative annual compounding, no contributions.</p><div id="calculator"></div><script>sophon.explorer('#calculator',{controls:[{id:'principal',label:'Starting amount',min:1000,max:20000,value:5000,step:100,prefix:'$'},{id:'rate',label:'Annual return',min:0,max:12,value:6,step:0.5,suffix:'%'},{id:'years',label:'Years',min:1,max:40,value:20}],calculate({principal,rate,years}){const labels=Array.from({length:years+1},(_,i)=>i);const values=labels.map(year=>principal*(1+rate/100)**year);const balance=values.at(-1);return {metrics:[{label:'Final balance',value:balance,currency:'USD'},{label:'Interest earned',value:balance-principal,currency:'USD'}],chart:{labels,series:[{name:'Balance',values}],xLabel:'Year',yLabel:'Balance',currency:'USD'}}}});</script></body></html>
\`\`\``
