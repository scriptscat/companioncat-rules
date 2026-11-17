#!/usr/bin/env node
// Checks rule packs: each file must parse as JSON, pass schema/v1.json, and every
// {{ }} expression inside it must be valid CEL that only uses the rule variables.
// Usage: node scripts/check.mjs [file.json ...]   (default: every packs/*.json)
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Validator } from '@cfworker/json-schema'
import { Environment } from '@marcbachmann/cel-js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// Spec R8.3: the only variables an expression may reference.
const VARIABLES = new Set([
  'settings', 'vars', 'input', 'secret', 'options', 'selection', 'page', 'site',
  'steps', 'response', 'stream', 'result', 'item', 'params', 'value'
])
// Round 2 R1.4: only an automation entry's triggers and run may read the page, through
// these functions and the `trigger` variable. Everywhere else they are errors.
const PAGE_FUNCTIONS = new Set(['text', 'attr', 'describe', 'outline', 'closest', 'within', 'visible'])
const PAGE_VARIABLES = new Set(['trigger'])
// An entry is an automation entry when its run has one of these steps (as in the schema).
const AUTOMATION_STEPS = ['find', 'act', 'ask', 'if', 'repeat', 'stop']
const ONLY_AUTOMATION = "can only be used in an automation entry's triggers and run"
// CEL's built-in type names, usable as values: type(x) == map.
const TYPE_NAMES = new Set(['bool', 'int', 'uint', 'double', 'string', 'bytes', 'list', 'map', 'null_type', 'type'])
// CEL macros whose first argument binds an iteration variable.
const MACROS = new Set(['all', 'exists', 'exists_one', 'map', 'filter'])
// Spec R8.1: the only functions an expression may call (plus the standard macros above);
// the rest of CEL's standard library (matches, startsWith, int(), type(), ...) is refused.
const FUNCTIONS = new Set([
  'concat', 'replace', 'split', 'join', 'contains', 'urlencode', 'base64', 'hex', 'md5', 'sha256',
  'hmacSha256', 'now', 'unix', 'uuid', 'random', 'json', 'extractJson', 'match', 'langName',
  'languages', 'lang', 'host', 'has', 'size'
])

// Spec R8.4 limits.
const cel = new Environment({
  homogeneousAggregateLiterals: false,
  limits: { maxAstNodes: 2000, maxDepth: 32, maxListElements: 1000, maxMapEntries: 1000 }
})

const validator = new Validator(
  JSON.parse(readFileSync(path.join(root, 'schema', 'v1.json'), 'utf8')),
  '2020-12',
  false
)

// Finds every {{ }} in a string. The closing }} must sit outside CEL string literals
// and outside map literal braces, so `{{ {'a': {'b': 1}} }}` is one expression.
export function scanTemplates (text) {
  const found = []
  let i = text.indexOf('{{')
  while (i !== -1) {
    const start = i + 2
    let depth = 0
    let quote = null
    let end = -1
    for (let j = start; j < text.length; j++) {
      const ch = text[j]
      if (quote) {
        if (ch === '\\') { j++; continue }
        if (text.startsWith(quote, j)) { j += quote.length - 1; quote = null }
        continue
      }
      if (ch === '"' || ch === "'") {
        quote = text.startsWith(ch.repeat(3), j) ? ch.repeat(3) : ch
        j += quote.length - 1
      } else if (ch === '{') {
        depth++
      } else if (ch === '}') {
        if (depth === 0 && text[j + 1] === '}') { end = j; break }
        if (depth > 0) depth--
      }
    }
    if (end === -1) {
      found.push({ offset: i, error: 'unclosed {{ — no matching }}' })
      break
    }
    found.push({ offset: i, source: text.slice(start, end) })
    i = text.indexOf('{{', end + 2)
  }
  return found
}

// has() only takes a field path rooted at a variable, e.g. has(a.b.c); cel-js
// parses other forms but rejects them when the expression is checked or run.
function isFieldPath (node) {
  if (node?.op !== '.' && node?.op !== '.?') return false
  while (node.op === '.' || node.op === '.?') node = node.args[0]
  return node.op === 'id'
}

// Collects identifiers that are not R8.3 variables (macro iteration variables are
// bound inside their macro), calls outside the whitelist and malformed has() calls.
// `page` is true inside an automation entry's triggers and run.
function findProblems (node, bound, out, page) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const n of node) findProblems(n, bound, out, page)
    return
  }
  if (!node.op) return
  if (node.op === 'id') {
    const name = node.args
    if (bound.has(name) || VARIABLES.has(name) || TYPE_NAMES.has(name) || (page && PAGE_VARIABLES.has(name))) return
    out.push({
      message: PAGE_VARIABLES.has(name)
        ? `variable "${name}" ${ONLY_AUTOMATION}`
        : `unknown variable "${name}" (allowed: ${[...VARIABLES].join(', ')})`,
      pos: node.pos
    })
    return
  }
  if (node.op === 'call' || node.op === 'rcall') {
    const name = node.args[0]
    if (PAGE_FUNCTIONS.has(name) && !page) {
      out.push({ message: `function ${name}() ${ONLY_AUTOMATION}`, pos: node.pos })
    } else if (!FUNCTIONS.has(name) && !MACROS.has(name) && !PAGE_FUNCTIONS.has(name)) {
      out.push({ message: `function ${name}() is not in the R8.1 whitelist`, pos: node.pos })
    }
  }
  if (node.op === 'call' && node.args[0] === 'has' && !isFieldPath(node.args[1]?.[0])) {
    out.push({ message: 'has() needs a field path such as has(input.from)', pos: node.pos })
  }
  if (node.op === 'rcall' && MACROS.has(node.args[0]) && node.args[2]?.[0]?.op === 'id') {
    const [, receiver, [iter, ...body]] = node.args
    findProblems(receiver, bound, out, page)
    findProblems(body, new Set([...bound, iter.args]), out, page)
    return
  }
  findProblems(node.args, bound, out, page)
}

function checkExpression (source, page) {
  let ast
  try {
    ast = cel.parse(source).ast
  } catch (err) {
    return { message: err.message.split('\n')[0], pos: err.node?.pos ?? 0 }
  }
  const problems = []
  findProblems(ast, new Set(), problems, page)
  return problems[0] ?? null
}

const pointerOf = (...parts) => parts.map((p) => `/${String(p).replaceAll('~', '~0').replaceAll('/', '~1')}`).join('')

export function isAutomationEntry (entry) {
  return Array.isArray(entry?.run) &&
    entry.run.some((step) => step && typeof step === 'object' && AUTOMATION_STEPS.some((k) => k in step))
}

// JSON pointers under which the page functions are allowed: each automation entry's triggers and run.
function pagePointers (pack) {
  const out = []
  const features = Array.isArray(pack?.features) ? pack.features : []
  features.forEach((feature, f) => {
    const entries = Array.isArray(feature?.entries) ? feature.entries : []
    entries.forEach((entry, e) => {
      if (!isAutomationEntry(entry)) return
      for (const field of ['triggers', 'run']) out.push(pointerOf('features', f, 'entries', e, field))
    })
  })
  return out
}

function * strings (value, pointer = '') {
  if (typeof value === 'string') {
    yield [pointer, value]
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield * strings(value[i], `${pointer}/${i}`)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield * strings(v, pointer + pointerOf(k))
  }
}

// cfworker reports every enclosing failure (allOf, $ref, properties…); keep the
// deepest ones so each problem is reported once at its own field.
// A field rejected by additionalProperties / unevaluatedProperties: false shows up
// as keyword "false"; when the field also failed its own schema, unevaluatedProperties
// reports it again, so the "false" error only counts if it is the only one there.
const CONTAINER_KEYWORDS = new Set(['properties', 'items', 'allOf', '$ref', 'additionalProperties', 'unevaluatedProperties', 'false'])

function describe ({ path, keyword, message }) {
  if (keyword === 'false') return `unknown field "${path.split('/').pop()}"`
  if (keyword === 'maxProperties') return 'too many fields here (write only one)'
  return message
}

function leafErrors (errors) {
  const units = errors.map((e) => ({ path: e.instanceLocation.replace(/^#/, ''), keyword: e.keyword, message: e.error }))
  const leaves = units.filter((e) => !units.some((o) => o.path.startsWith(e.path + '/')))
  const seen = new Set()
  return leaves.filter((e) => {
    const key = `${e.path}|${e.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return !CONTAINER_KEYWORDS.has(e.keyword) || leaves.filter((o) => o.path === e.path).length === 1
  }).map((e) => ({ path: e.path, message: describe(e) }))
}

export function checkPack (text) {
  let pack
  try {
    pack = JSON.parse(text)
  } catch (err) {
    return [{ path: '', message: `not valid JSON: ${err.message}` }]
  }
  const problems = []
  const result = validator.validate(pack)
  if (!result.valid) problems.push(...leafErrors(result.errors))
  const pageAt = pagePointers(pack)
  for (const [pointer, value] of strings(pack)) {
    const page = pageAt.some((p) => pointer === p || pointer.startsWith(p + '/'))
    for (const t of scanTemplates(value)) {
      if (t.error) {
        problems.push({ path: pointer, message: `${t.error} in ${JSON.stringify(value)}` })
        continue
      }
      const bad = checkExpression(t.source, page)
      if (bad) {
        problems.push({
          path: pointer,
          message: `expression error at column ${t.offset + 2 + bad.pos + 1}: ${bad.message}\n    {{${t.source}}}`
        })
      }
    }
  }
  return problems
}

function main (args) {
  const files = args.length > 0
    ? args.map((f) => path.resolve(f))
    : readdirSync(path.join(root, 'packs')).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(root, 'packs', f))
  let failed = 0
  for (const file of files) {
    const name = path.relative(process.cwd(), file) || file
    let problems
    try {
      problems = checkPack(readFileSync(file, 'utf8'))
    } catch (err) {
      problems = [{ path: '', message: `cannot read file: ${err.message}` }]
    }
    if (problems.length === 0) {
      console.log(`ok   ${name}`)
      continue
    }
    failed++
    console.error(`FAIL ${name}`)
    for (const p of problems) console.error(`  ${p.path || '/'}: ${p.message}`)
  }
  if (failed > 0) {
    console.error(`\n${failed} of ${files.length} file(s) failed`)
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
