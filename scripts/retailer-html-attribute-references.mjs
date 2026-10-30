/**
 * One-pass, bounded HTML character-reference decoding for observed *attribute*
 * evidence. Named entities are a fixed ASCII whitelist; numeric references
 * accept HTML's optional semicolon only when all digits fit the bounded
 * grammar. Never decode the output again or synthesize markup/URLs.
 */
const NAMED = Object.freeze({
  sol: '/', colon: ':', amp: '&', Tab: '\t', NewLine: '\n',
  comma: ',', semi: ';',
})
export function decodeObservedHtmlAttribute(value) {
  if (typeof value !== 'string') return value
  return value.replace(/&(sol|colon|amp|Tab|NewLine|comma|semi);|&#(?:[xX]([0-9a-fA-F]{1,6})(?![0-9a-fA-F])|([0-9]{1,7})(?![0-9]));?/g,
    (raw, named, hex, decimal) => {
      if (named !== undefined) return NAMED[named]
      const point = Number.parseInt(hex ?? decimal, hex === undefined ? 10 : 16)
      return point > 0 && point <= 0x10ffff &&
        !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : raw
    })
}
