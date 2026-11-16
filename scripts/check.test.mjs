import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const fixture = (name) => path.join('test', 'fixtures', name)

function check (...files) {
  const r = spawnSync(process.execPath, ['scripts/check.mjs', ...files], { cwd: root, encoding: 'utf8' })
  return { code: r.status, out: r.stdout + r.stderr }
}

test('both official packs pass by default', () => {
  const { code, out } = check()
  assert.equal(code, 0, out)
  assert.match(out, /packs\/official-translate\.json/)
  assert.match(out, /packs\/official-llm\.json/)
})

test('a minimal valid pack passes', () => {
  const { code, out } = check(fixture('valid-minimal.json'))
  assert.equal(code, 0, out)
})

test('an unknown trigger fails with the field path', () => {
  const { code, out } = check(fixture('invalid-trigger.json'))
  assert.equal(code, 1, out)
  assert.match(out, /invalid-trigger\.json/)
  assert.match(out, /\/features\/0\/entries\/0\/triggers\/0\/on/)
})

test('an error type outside R6.3 fails with the field path', () => {
  const { code, out } = check(fixture('invalid-error-type.json'))
  assert.equal(code, 1, out)
  assert.match(out, /\/providers\/0\/limits\/retry\/on\/1/)
})

test('a schema major version other than 1 fails', () => {
  const { code, out } = check(fixture('schema-major-2.json'))
  assert.equal(code, 1, out)
  assert.match(out, /\/schema\b/)
})

test('a CEL syntax error fails with the field path, the expression and its position', () => {
  const { code, out } = check(fixture('cel-syntax-error.json'))
  assert.equal(code, 1, out)
  assert.match(out, /\/features\/0\/entries\/0\/run\/0\/set\/to/)
  assert.match(out, /settings\.swapIfSame && selection\.lang ==/)
  assert.match(out, /column \d+/)
})

test('an unclosed {{ fails with the field path', () => {
  const { code, out } = check(fixture('cel-unclosed.json'))
  assert.equal(code, 1, out)
  assert.match(out, /\/features\/0\/entries\/0\/present\/view\/value/)
  assert.match(out, /\{\{/)
})

test('a file that is not JSON fails with its name', () => {
  const { code, out } = check(fixture('not-json.json'))
  assert.equal(code, 1, out)
  assert.match(out, /not-json\.json/)
})

test('one bad file fails the run even when others pass', () => {
  const { code } = check(fixture('valid-minimal.json'), fixture('cel-syntax-error.json'))
  assert.equal(code, 1)
})

test('an identifier outside the R8.3 variables fails with the field path', () => {
  const { code, out } = check(fixture('unknown-variable.json'))
  assert.equal(code, 1, out)
  assert.match(out, /\/features\/0\/entries\/0\/run\/0\/input\/texts: .*unknown variable "blocks"/)
  assert.match(out, /\/features\/0\/entries\/0\/present\/view\/with\/results: .*unknown variable "results"/)
})

test('an unknown component property fails with the field path', () => {
  const { code, out } = check(fixture('invalid-component.json'))
  assert.equal(code, 1, out)
  assert.match(out, /\/views\/card\/body/)
  assert.match(out, /colour/)
})

test('}} inside a map literal or a CEL string does not end the expression', () => {
  const { code, out } = check(fixture('braces-and-quotes.json'))
  assert.equal(code, 0, out)
})

test('file arguments resolve against the working directory', () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/check.mjs'), 'fixtures/valid-minimal.json'], { cwd: path.join(root, 'test'), encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('only the failing field is reported, not every enclosing object', () => {
  const { out } = check(fixture('invalid-trigger.json'))
  assert.doesNotMatch(out, /^ {2}\/: /m)
})

test('has() on anything but a field path fails, as cel-js rejects it when checking', () => {
  const { code, out } = check(fixture('has-invalid.json'))
  assert.equal(code, 1, out)
  assert.match(out, /\/bridges\/0\/check: .*has\(\)/)
})
