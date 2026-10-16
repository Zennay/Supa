import './RetailerSearchView.css'

// SUPA production deliberately forbids direct browser fetch/XHR. The price
// search is therefore a same-origin, server-rendered HTML form that queries
// the existing SQLite read-only API. Browsing it never contacts retailers.
export function RetailerSearchView() {
  return (
    <section className="screen retailer-search" aria-label="Supermarktprijzen zoeken">
      <div className="section-heading">
        <div>
          <span className="eyebrow">SUPA · Productzoeker</span>
          <h2>Zoek supermarktprijzen</h2>
        </div>
      </div>
      <p className="disclaimer">Alleen online prijzen van de laatste 24 uur.
        De winkelprijs kan afwijken. Geen gegarandeerde besparing.
      </p>
      <iframe
        className="retailer-search-frame"
        title="Zoek actuele supermarktprijzen"
        src="/retailer-zoeken"
        loading="eager"
        referrerPolicy="no-referrer"
      />
    </section>
  )
}
