// Local, read-only syntax guard for operator-supplied private M3 JSON.
// JSON.parse silently selects a value when an object repeats a key, even when
// the keys differ only by JSON Unicode escapes. A "bound" evidence report
// must not accept that ambiguous source representation.
const ERROR = 'M3 private JSON key integrity refused'
const fail = () => { throw new SyntaxError(ERROR) }
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+\-]?[0-9]+)?/y
const HEX4 = /^[0-9a-fA-F]{4}$/u

export function parsePrivateM3UniqueKeyJson(source) {
  if (typeof source !== 'string') fail()
  let index = 0
  const skipSpace = () => {
    while (index < source.length) {
      const code = source.charCodeAt(index)
      if (code !== 9 && code !== 10 && code !== 13 && code !== 32) break
      index++
    }
  }
  const readString = () => {
    if (source[index] !== '"') fail()
    const first = index++
    while (index < source.length) {
      const char = source[index]
      if (char === '"') {
        index++
        // JSON.parse interprets escaped aliases (e.g. "\\u0061") as the
        // same property key as literal "a"; duplicates are compared decoded.
        try { return JSON.parse(source.slice(first, index)) } catch { fail() }
      }
      if (char === '\\') {
        index++
        const escape = source[index]
        if (escape === 'u') {
          if (!HEX4.test(source.slice(index + 1, index + 5))) fail()
          index += 5
        } else {
          if (!['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(escape)) fail()
          index++
        }
      } else {
        if (source.charCodeAt(index) < 32) fail()
        index++
      }
    }
    fail()
  }
  const value = (depth) => {
    if (depth > 128) fail()
    skipSpace()
    const current = source[index]
    if (current === '{') {
      index++
      skipSpace()
      const seen = new Set()
      if (source[index] === '}') { index++; return }
      while (index < source.length) {
        const key = readString()
        if (seen.has(key)) fail()
        seen.add(key)
        skipSpace()
        if (source[index++] !== ':') fail()
        value(depth + 1)
        skipSpace()
        if (source[index] === '}') { index++; return }
        if (source[index++] !== ',') fail()
        skipSpace()
      }
      fail()
    }
    if (current === '[') {
      index++
      skipSpace()
      if (source[index] === ']') { index++; return }
      while (index < source.length) {
        value(depth + 1)
        skipSpace()
        if (source[index] === ']') { index++; return }
        if (source[index++] !== ',') fail()
      }
      fail()
    }
    if (current === '"') { readString(); return }
    for (const keyword of ['true', 'false', 'null']) {
      if (source.startsWith(keyword, index)) { index += keyword.length; return }
    }
    NUMBER.lastIndex = index
    const numeric = NUMBER.exec(source)
    if (!numeric) fail()
    index = NUMBER.lastIndex
  }
  try {
    value(0)
    skipSpace()
    if (index !== source.length) fail()
    return JSON.parse(source)
  } catch { fail() }
}
