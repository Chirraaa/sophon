const flow = `<!doctype html><html><head><title>How a web request travels</title><style>
.flow{display:flex;align-items:center;gap:12px;padding:24px 0}.node{border:1px solid #ffffff30;border-radius:10px;padding:18px 10px;flex:1;background:#333334;color:#eee}.node strong,.node span{display:block}.node span{font-size:11px;opacity:.75;margin-top:8px}.node:nth-of-type(2){background:#413572}.node:nth-of-type(3){background:#075647}.node:nth-of-type(4){background:#71391e}.arrow{color:#777}@media(max-width:500px){.flow{flex-direction:column}.node{width:100%}.arrow{transform:rotate(90deg)}}
</style></head><body><p style="color:#999">Select any stage to explore it.</p><div class="flow">
<button class="node" onclick="sophon.followUp('Explain how the browser sends a request')"><strong>Browser</strong><span>Sends request</span></button><span class="arrow">→</span>
<button class="node" onclick="sophon.followUp('Explain the load balancer')"><strong>Load balancer</strong><span>Picks a server</span></button><span class="arrow">→</span>
<button class="node" onclick="sophon.followUp('Explain the app server')"><strong>App server</strong><span>Runs the logic</span></button><span class="arrow">→</span>
<button class="node" onclick="sophon.followUp('Explain the database')"><strong>Database</strong><span>Stores the data</span></button>
</div></body></html>`

const chart = `<!doctype html><html><head><title>Web and mobile signups</title></head><body>
<div style="display:flex;gap:20px"><span style="color:#60a5fa">● Web signups</span><span style="color:#fb923c">◆ Mobile signups</span><span style="margin-left:auto;color:#888">Sample data</span></div>
<svg id="chart" viewBox="0 0 640 280" role="img" aria-label="Monthly web and mobile signups"></svg><p id="hover" style="text-align:center;color:#aaa;min-height:18px">Hover over a point for its value.</p>
<script>
const svg=document.getElementById('chart'),months=['Jan','Feb','Mar','Apr','May','Jun'];
const x=i=>45+i*112,y=v=>240-v*.68;
let html='';for(let v=0;v<=300;v+=50)html+='<path d="M45 '+y(v)+'H610" stroke="#ffffff18"/><text x="36" y="'+(y(v)+4)+'" text-anchor="end" fill="#888" font-size="11">'+v+'</text>';
months.forEach((m,i)=>html+='<text x="'+x(i)+'" y="264" text-anchor="middle" fill="#888" font-size="11">'+m+'</text>');
[[120,150,170,190,210,230],[60,90,130,175,230,290]].forEach((data,j)=>{const color=['#60a5fa','#fb923c'][j];html+='<polyline points="'+data.map((v,i)=>x(i)+','+y(v)).join(' ')+'" fill="none" stroke="'+color+'" stroke-width="2" '+(j?'stroke-dasharray="6 4"':'')+'/>';data.forEach((v,i)=>html+='<circle tabindex="0" cx="'+x(i)+'" cy="'+y(v)+'" r="5" fill="'+color+'" data-label="'+months[i]+': '+v+' '+(j?'mobile':'web')+' signups"><title>'+v+' signups</title></circle>')});
svg.innerHTML=html;svg.querySelectorAll('circle').forEach(point=>{point.onpointerenter=point.onfocus=()=>document.getElementById('hover').textContent=point.dataset.label});
</script></body></html>`

const widget = `<!doctype html><html><head><title>Explore compound growth</title><style>
.controls{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}label{font-size:12px;color:#bbb}input{width:100%;margin-top:14px}.stats{display:flex;gap:80px;margin:28px 0}.stats small{color:#999}.stats strong{display:block;font-size:24px;margin-top:5px}@media(max-width:430px){.controls{grid-template-columns:1fr}.stats{gap:24px}}
</style></head><body><div class="controls">
<label>Starting amount: <output id="pValue"></output><input aria-label="Starting amount" id="principal" type="range" min="1000" max="20000" step="500" value="5000"></label>
<label>Annual return: <output id="rValue"></output><input aria-label="Annual return" id="rate" type="range" min="0" max="12" step=".5" value="6"></label>
<label>Years: <output id="yValue"></output><input aria-label="Years" id="years" type="range" min="1" max="40" value="20"></label>
</div><div class="stats"><div><small>Final balance</small><strong id="balance"></strong></div><div><small>Growth from interest</small><strong id="growth"></strong></div></div>
<svg id="plot" viewBox="0 0 640 250" role="img" aria-label="Balance over time"></svg><p style="color:#888;font-size:11px">Illustration only. Constant annual return, no fees or additional contributions.</p>
<script>
const principal=document.getElementById('principal'),rate=document.getElementById('rate'),years=document.getElementById('years'),money=v=>'$'+Math.round(v).toLocaleString('en-US');
function draw(){const p=+principal.value,r=+rate.value,n=+years.value,final=p*(1+r/100)**n,max=Math.ceil(final/2000)*2000,x=t=>50+t/n*560,y=v=>210-v/max*185;
document.getElementById('pValue').textContent=money(p);document.getElementById('rValue').textContent=r+'%';document.getElementById('yValue').textContent=n;document.getElementById('balance').textContent=money(final);document.getElementById('growth').textContent=money(final-p);
let html='';for(let i=0;i<=4;i++){const v=max*i/4;html+='<path d="M50 '+y(v)+'H610" stroke="#ffffff18"/><text x="40" y="'+(y(v)+4)+'" text-anchor="end" fill="#888" font-size="11">'+money(v)+'</text>'}const points=Array.from({length:n+1},(_,t)=>x(t)+','+y(p*(1+r/100)**t)).join(' ');
html+='<polygon points="50,210 '+points+' 610,210" fill="#60a5fa12"/><polyline id="curve" points="'+points+'" stroke="#60a5fa" stroke-width="2" fill="none"/><path d="M50 '+y(p)+'H610" stroke="#888" stroke-dasharray="5 4"/><text x="50" y="235" fill="#888">0</text><text x="610" y="235" text-anchor="end" fill="#888">'+n+' years</text>';document.getElementById('plot').innerHTML=html}
[principal,rate,years].forEach(input=>input.addEventListener('input',draw));draw();
</script></body></html>`

module.exports = {
  flow,
  chart,
  widget,
  showcase: [
    'Here are three visuals. Each is drawn in the chat.',
    ...[flow, chart, widget].map((source) => '```html\n' + source + '\n```')
  ].join('\n\n')
}
