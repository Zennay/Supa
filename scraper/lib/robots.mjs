// Minimal robots.txt (RFC 9309) parser: groups per user-agent, Allow/Disallow
// with `*` and `$`, longest-match wins, Allow wins ties, plus Crawl-delay.

function compilePattern(path) {
  const anchored = path.endsWith('$')
  const body = anchored ? path.slice(0, -1) : path
  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp('^' + escaped + (anchored ? '$' : ''))
}

export function parseRobots(text) {
  const groups = []
  let current = null
  let lastWasAgent = false

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const sep = line.indexOf(':')
    if (sep < 0) continue
    const key = line.slice(0, sep).trim().toLowerCase()
    const value = line.slice(sep + 1).trim()

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue

    if (key === 'allow' || key === 'disallow') {
      if (key === 'disallow' && value === '') continue
      current.rules.push({
        allow: key === 'allow',
        length: value.length,
        regex: compilePattern(value),
      })
    } else if (key === 'crawl-delay') {
      const delay = Number(value)
      if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay
    }
  }

  return { groups }
}

function groupsFor(robots, userAgent) {
  const token = userAgent.toLowerCase()
  const specific = robots.groups.filter((g) =>
    g.agents.some((a) => a !== '*' && token.includes(a)),
  )
  if (specific.length) return specific
  return robots.groups.filter((g) => g.agents.includes('*'))
}

export function isAllowed(robots, userAgent, urlOrPath) {
  if (!robots) return true
  let path = urlOrPath
  try {
    const u = new URL(urlOrPath)
    path = u.pathname + u.search
  } catch {
    // already a path
  }
  if (path === '/robots.txt') return true

  let best = null
  for (const group of groupsFor(robots, userAgent)) {
    for (const rule of group.rules) {
      if (!rule.regex.test(path)) continue
      if (
        !best ||
        rule.length > best.length ||
        (rule.length === best.length && rule.allow && !best.allow)
      ) {
        best = rule
      }
    }
  }
  return best ? best.allow : true
}

export function crawlDelaySeconds(robots, userAgent) {
  if (!robots) return null
  const delays = groupsFor(robots, userAgent)
    .map((g) => g.crawlDelay)
    .filter((d) => d !== null)
  return delays.length ? Math.max(...delays) : null
}
