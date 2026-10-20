import{l as i}from"./privateBasketComparisonCsv-D5yqCuzk.js";function l(n){if(n.length===0||n.length>100)throw new Error("Geen extra boodschappen voor CSV.");const r=e=>e.map(t=>i(t)).join(";"),o=[r(["Artikel","Hoeveelheid","Eenheid","Afgevinkt","Winkel","Prijs"]),...n.map(e=>r([e.name,String(e.quantity),e.unit==="piece"?"stuks":e.unit,e.done?"ja":"nee","Niet gekoppeld","Onbekend"]))].join(`\r
`)+`\r
`;if(new TextEncoder().encode(o).length>256e3)throw new Error("Extra lijst is te groot voor CSV.");return o}export{l as exportOwnExtraGroceriesCsv};
