import test from 'node:test'
import assert from 'node:assert/strict'
import { renderPrivateComparison } from '../scripts/retailer-show-private-comparison.mjs'
const line=(cents, status='matched')=>({status, packs:1, packPriceCents:cents, totalCents:cents, sourceUrl:'https://www.plus.nl/?secret=never-print'})
function fixture(){return {format:'supa-local-snapshot-comparison-v1',captureSummary:[{supermarket:'plus',parsedProducts:1,htmlFile:'private.html'}],comparison:{provenance:'offline-snapshot-preview',claimable:false,comparable:true,cheaperStore:'dekamarkt',savingsCents:10,stores:{plus:{subtotalCents:129,complete:true},dekamarkt:{subtotalCents:119,complete:true}},lines:[{ingredient:'Fictional milk',plus:line(129),dekamarkt:line(119),differenceCents:-10}]}}}
test('private operator view shows two prices, honest labels and no source secrets',()=>{const text=renderPrivateComparison(fixture()); assert.match(text,/GEEN LIVE PRIJZEN/);assert.match(text,/PLUS: 1 × €1,29/);assert.match(text,/ALLEEN OFFLINE MANDVERSCHIL/);assert.doesNotMatch(text,/private\\.html|never-print/)})
test('missing stock withholds basket saving and line difference',()=>{const f=fixture(); f.comparison.lines[0].dekamarkt=line(119,'availability_unknown');f.comparison.lines[0].differenceCents=null;f.comparison.comparable=false;f.comparison.savingsCents=null;f.comparison.cheaperStore=null;f.comparison.stores.dekamarkt.complete=false;const text=renderPrivateComparison(f);assert.match(text,/voorraad onbekend/);assert.match(text,/GEEN VOLLEDIGE MANDVERGELIJKING/);assert.doesNotMatch(text,/ALLEEN OFFLINE MANDVERSCHIL/)})
test('shared physical package is not presented as free ingredient',()=>{const f=fixture();f.comparison.lines[0].plus={...line(129),packs:0,totalCents:0,sharedPackWithIngredientId:'milk-other'};assert.ok(renderPrivateComparison(f).includes('gedeeld pak (niet gratis)'))})

test('forged public-claimable result cannot be rendered as offline',()=>{const f=fixture();f.comparison.claimable=true;assert.throws(()=>renderPrivateComparison(f),/Invalid or claimable/)})

test('operator text is readable across actual newline boundaries and keeps ingredient label',()=>{const out=renderPrivateComparison(fixture());assert.ok(out.includes(String.fromCharCode(10)+'Mandregels:'));assert.ok(out.includes('Fictional milk:'))})

test('operator withholds forged basket winner or impossible savings totals',()=>{
  const f=fixture()
  f.comparison.savingsCents=9999
  assert.match(renderPrivateComparison(f),/GEEN VOLLEDIGE MANDVERGELIJKING/)
  assert.doesNotMatch(renderPrivateComparison(f),/ALLEEN OFFLINE MANDVERSCHIL/)
  f.comparison.savingsCents=10
  f.comparison.cheaperStore='plus'
  assert.match(renderPrivateComparison(f),/GEEN VOLLEDIGE MANDVERGELIJKING/)
})

test('operator refuses to show a row price contradicting package arithmetic',()=>{
  const f=fixture()
  f.comparison.lines[0].plus.totalCents=1
  assert.match(renderPrivateComparison(f),/PLUS: prijs onbetrouwbaar/)
})
