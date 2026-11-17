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
// CEL's built-in type names, usable as values: type(x) == map.
const TYPE_NAMES = new Set(['bool', 'int', 'uint', 'double', 'string', 'bytes', 'list', 'map', 'null_type', 'type'])
// CEL macros whose first argument binds an iteration variable.
const MACROS = new Set(['all', 'exists', 'exists_one', 'map', 'filter'])

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
// bound inside their macro) and malformed has() calls.
function findProblems (node, bound, out) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const n of node) findProblems(n, bound, out)
    return
  }
  if (!node.op) return
  if (node.op === 'id') {
    if (!bound.has(node.args) && !VARIABLES.has(node.args) && !TYPE_NAMES.has(node.args)) {
      out.push({ message: `unknown variable "${node.args}" (allowed: ${[...VARIABLES].join(', ')})`, pos: node.pos })
    }
    return
  }
  if (node.op === 'call' && node.args[0] === 'has' && !isFieldPath(node.args[1]?.[0])) {
    out.push({ message: 'has() needs a field path such as has(input.from)', pos: node.pos })
  }
  if (node.op === 'rcall' && MACROS.has(node.args[0]) && node.args[2]?.[0]?.op === 'id') {
    const [, receiver, [iter, ...body]] = node.args
    findProblems(receiver, bound, out)
    findProblems(body, new Set([...bound, iter.args]), out)
    return
  }
  findProblems(node.args, bound, out)
}

function checkExpression (source) {
  let ast
  try {
    ast = cel.parse(source).ast
  } catch (err) {
    return { message: err.message.split('\n')[0], pos: err.node?.pos ?? 0 }
  }
  const problems = []
  findProblems(ast, new Set(), problems)
  return problems[0] ?? null
}

function * strings (value, pointer = '') {
  if (typeof value === 'string') {
    yield [pointer, value]
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield * strings(value[i], `${pointer}/${i}`)
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      yield * strings(v, `${pointer}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`)
    }
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
  for (const [pointer, value] of strings(pack)) {
    for (const t of scanTemplates(value)) {
      if (t.error) {
        problems.push({ path: pointer, message: `${t.error} in ${JSON.stringify(value)}` })
        continue
      }
      const bad = checkExpression(t.source)
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
