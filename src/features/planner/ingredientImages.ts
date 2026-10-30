import { ingredientIconFiles } from '../home/figmaAssets'

/** Keyword → Twemoji code point. First match wins; the carrot is the fallback. */
const keywords: [RegExp, string][] = [
  [/rijst|rice/, '1f35a'], [/\bei(eren)?\b|egg/, '1f95a'], [/edamame/, '1fadb'],
  [/currypasta|chili|peper\b|sambal/, '1f336'], [/currysaus|curry/, '1f35b'],
  [/sauce|saus|ketchup|ketjap/, '1f96b'], [/kokos/, '1f965'], [/paprika/, '1fad1'],
  [/komkommer|courgette/, '1f952'], [/tortilla|wrap|burrito/, '1f32f'],
  [/kaas|cheese/, '1f9c0'], [/bonen|linzen|kikkererwt/, '1fad8'],
  [/kip|chicken/, '1f357'], [/spaghetti|pasta|penne|macaroni/, '1f35d'],
  [/noodle|mie\b/, '1f35c'], [/tomaat|tomaten/, '1f345'], [/spinazie|sla\b|kool\b|boerenkool/, '1f96c'],
  [/bao/, '1f95f'], [/panko|brood|broodje/, '1f35e'], [/broccoli|bloemkool/, '1f966'],
  [/yoghurt|melk|room\b|kwark/, '1f95b'], [/ui\b|uien/, '1f9c5'], [/knoflook/, '1f9c4'],
  [/champignon|paddenstoel/, '1f344'], [/mais/, '1f33d'], [/avocado/, '1f951'],
  [/citroen|limoen/, '1f34b'], [/aardappel|patat/, '1f954'], [/vis\b|zalm|tonijn/, '1f41f'],
  [/garnaal/, '1f364'],
]

/** A real picture for an ingredient, chosen from its label. */
export function ingredientImage(label: string): string {
  const text = label.toLocaleLowerCase('nl')
  for (const [pattern, code] of keywords) {
    const url = ingredientIconFiles[code]
    if (pattern.test(text) && url) return url
  }
  return ingredientIconFiles['1f955']
}
