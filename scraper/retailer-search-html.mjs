/**
 * Server-rendered, same-origin search page.
 * No browser fetch/XHR is introduced into the SUPA production app.
 */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  })[c])
}
const euro = cents => '€ '+(cents/100).toFixed(2).replace('.',',')
const dateNl = timestamp => new Date(timestamp).toLocaleString('nl-NL',{
  day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',
  timeZone:'Europe/Amsterdam',
})
const stylesheet = [
  'html{font-family:Inter,system-ui,sans-serif;color:#1e231e;background:#f8f7f2}',
  'body{margin:0;padding:5px 1px}',
  'label{display:block;font-weight:750;margin:8px 0}',
  'input{width:100%;box-sizing:border-box;border-radius:14px;border:1px solid #deddd7;padding:13px;font:inherit}',
  'button{margin-top:10px;border:0;border-radius:14px;background:#b8e66c;padding:12px 18px;font-weight:800;font:inherit}',
  'p,small{color:#686d66;font-size:13px;line-height:1.5}',
  'article{background:white;border:1px solid #deddd7;border-radius:16px;margin:10px 0;padding:13px}',
  '.row{display:flex;align-items:center;justify-content:space-between;gap:12px}',
  'strong{overflow-wrap:anywhere}.price{font-size:20px;white-space:nowrap}',
  '.meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:7px;margin-top:10px}',
  'a{color:#1e231e;font-size:13px}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #28351b}',
].join('')
export function renderRetailerSearchHtml(query, payload) {
  const q=typeof query==='string' && query.length<=80 ? query : ''
  const rows=Array.isArray(payload?.results)?payload.results.slice(0,40):[]
  let notice
  if(q.trim().length<2)notice='Typ minimaal twee letters om te zoeken.'
  else if(payload?.availability==='sources-not-approved') {
    notice='Nog geen goedgekeurde actuele supermarktprijzen beschikbaar.'
  } else if(payload?.error) {
    notice='De actuele prijzendatabase is momenteel niet beschikbaar.'
  } else if(rows.length===0)notice='Geen recente prijzen gevonden.'
  else notice=rows.length+' recente prijsvermeldingen.'
  const cards=rows.map(hit=>'<article><div class="row"><strong>'+
    escapeHtml(hit.name)+'</strong><b class="price">'+
    escapeHtml(euro(hit.priceCents))+'</b></div>'+
    '<p>'+escapeHtml(hit.supermarketName)+
    (hit.pack?' · '+escapeHtml(hit.pack):'')+'</p>'+
    '<div class="meta"><small>'+ (hit.offer?'Aanbieding · ':'')+
    'Waargenomen: '+escapeHtml(dateNl(hit.observedAt))+
    '</small><a href="'+escapeHtml(hit.sourceUrl)+
    '" target="_blank" rel="noopener noreferrer">Bekijk bron</a></div></article>').join('')
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>SUPA supermarktprijzen zoeken</title><style>'+stylesheet+
    '</style></head><body><form action="/retailer-zoeken" method="get">'+
    '<label for="q">Zoek een product</label><input id="q" type="search" name="q" '+
    'maxlength="80" minlength="2" placeholder="Bijvoorbeeld rijst, kip of melk" '+
    'value="'+escapeHtml(q)+'"><button type="submit">Zoeken</button>'+
    '</form><p><a href="/">← Terug naar SUPA</a></p><p role="status" aria-live="polite">'+escapeHtml(notice)+'</p>'+
    '<div aria-label="Actuele prijzen">'+cards+'</div></body></html>'
}
