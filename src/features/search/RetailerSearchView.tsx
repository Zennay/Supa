import './RetailerSearchView.css'

// SUPA forbids direct browser networking AND executable embedded content.
// Submit a standard same-origin HTML GET form. The price results are
// rendered by the trusted localhost SQLite search server, not by JS.
export function RetailerSearchView() {
  return (
    <section className="screen retailer-search" aria-label="Supermarktprijzen zoeken">
      <div className="section-heading"><div>
        <span className="eyebrow">SUPA · Productzoeker</span>
        <h2>Zoek supermarktprijzen</h2>
      </div></div>
      <p className="disclaimer">Alleen online prijzen van de laatste 24 uur.
        Prijzen in de winkel kunnen afwijken; dit is geen gegarandeerde besparing.
      </p>
      <form action="/retailer-zoeken" method="get" className="retailer-search-form">
        <label className="search-label" htmlFor="retailer-query">Zoek een product</label>
        <input id="retailer-query" type="search" name="q"
          minLength={2} maxLength={80} required
          placeholder="Bijvoorbeeld rijst, kip of melk" autoComplete="off" />
        <button className="ghost-button" type="submit">Toon actuele prijzen</button>
      </form>
      <p className="disclaimer">SUPA zoekt in de recente prijzen uit de eigen
        supermarktendatabase. Als een winkel geen toegestane, verse prijs heeft,
        tonen we geen schatting. De resultaten openen als een gewone
        SUPA-zoekpagina.</p>
    </section>
  )
}
