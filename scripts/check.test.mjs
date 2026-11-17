import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'

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

test('match(text, regex) from R8.1 is accepted, including raw-string regexes', async () => {
  const { checkPack } = await import('./check.mjs')
  const pack = JSON.parse(readFileSync(path.join(root, fixture('valid-minimal.json')), 'utf8'))
  pack.features[0].entries[0].run[0].set.to = "{{ size(match(settings.page, 'IG:\"([0-9A-F]+)\"')) > 0 ? match(settings.page, r'\\[(\\d+),\"([^\"]+)\"')[1] : 'en' }}"
  assert.deepEqual(checkPack(JSON.stringify(pack)), [])
  pack.features[0].entries[0].run[0].set.to = "{{ match(page.html, '(') }}"
  assert.deepEqual(checkPack(JSON.stringify(pack)), [], 'regex validity is a runtime error, not a check error')
})

test('CEL type names such as map and list are not mistaken for variables', async () => {
  const { checkPack } = await import('./check.mjs')
  const pack = JSON.parse(readFileSync(path.join(root, fixture('valid-minimal.json')), 'utf8'))
  pack.features[0].entries[0].run[0].set.to = "{{ settings.x == map || settings.x == list ? 'a' : 'b' }}"
  assert.deepEqual(checkPack(JSON.stringify(pack)), [])
  pack.features[0].entries[0].run[0].set.to = '{{ settings.x == mapp }}'
  assert.match(checkPack(JSON.stringify(pack))[0]?.message ?? '', /unknown variable "mapp"/)
})

test('only the R8.1 whitelist and the standard macros can be called', async () => {
  const { checkPack } = await import('./check.mjs')
  const pack = JSON.parse(readFileSync(path.join(root, fixture('valid-minimal.json')), 'utf8'))
  for (const expr of ["settings.x.matches('a')", "type(settings.x) == map", "int(settings.x)", "settings.x.startsWith('a')"]) {
    pack.features[0].entries[0].run[0].set.to = `{{ ${expr} }}`
    assert.match(checkPack(JSON.stringify(pack))[0]?.message ?? '', /not in the R8\.1 whitelist/, expr)
  }
  pack.features[0].entries[0].run[0].set.to = "{{ [1].map(x, x).filter(x, x > 0).exists(x, true) && has(settings.x) && size(json(settings)) > 0 }}"
  assert.deepEqual(checkPack(JSON.stringify(pack)), [])
})

test('the round 2 automation format passes the schema and the expression check', () => {
  const { code, out } = check(fixture('valid-automation.json'))
  assert.equal(code, 0, out)
})

test('malformed automation shapes fail with the field path', async () => {
  const { checkPack } = await import('./check.mjs')
  const base = () => JSON.parse(readFileSync(path.join(root, fixture('valid-automation.json')), 'utf8'))
  const cases = [
    [(p) => { p.features[0].entries[0].triggers[0].on = 'appears' }, '/features/0/entries/0/triggers/0/on'],
    [(p) => { p.features[0].entries[0].run[3].below = 'maybe' }, '/features/0/entries/0/run/3/below'],
    [(p) => { p.features[0].entries[1].run[1].steps[0].selctor = 'a' }, '/features/0/entries/1/run/1/steps/0/selctor'],
    [(p) => { p.features[0].settings.threshold.format = 'money' }, '/features/0/settings/threshold/format'],
    [(p) => { p.features[0].entries[2].present.surface.type = 'corner-card' }, '/features/0/entries/2/present/surface/type']
  ]
  for (const [edit, pointer] of cases) {
    const pack = base()
    edit(pack)
    const problems = checkPack(JSON.stringify(pack))
    assert.ok(problems.some((p) => p.path === pointer), `${pointer}: ${JSON.stringify(problems)}`)
  }
})

test('page functions and trigger are accepted in an automation entry\'s triggers and run', async () => {
  const { checkPack } = await import('./check.mjs')
  const pack = JSON.parse(readFileSync(path.join(root, fixture('valid-automation.json')), 'utf8'))
  const skip = pack.features[0].entries[0]
  skip.triggers[0].enabled = '{{ visible(trigger.element) }}'
  skip.run[0].where = "{{ contains(text(item), '跳过') && attr(item, 'role') != 'x' }}"
  skip.run[2].input.question = "{{ describe(vars.candidates[0]) + outline(closest(trigger.element, 'div'), 300) }}"
  skip.run[0].within = "{{ within(trigger.element, '.player')[0] }}"
  assert.deepEqual(checkPack(JSON.stringify(pack)), [])
})

test('page functions and trigger anywhere else fail with the field path', async () => {
  const { checkPack } = await import('./check.mjs')
  const pack = JSON.parse(readFileSync(path.join(root, fixture('valid-automation.json')), 'utf8'))
  const [, , solve, page] = pack.features[0].entries
  page.run[0].input.to = '{{ text(vars.x) }}'
  page.triggers[1].enabled = '{{ trigger.on == "page-load" }}'
  solve.present.view.with.items = '{{ within(vars.q, "li") }}'
  pack.features[0].settings.below.default = '{{ visible(vars.x) }}'
  const problems = checkPack(JSON.stringify(pack))
  const at = (pointer) => problems.find((p) => p.path === pointer)?.message ?? ''
  assert.match(at('/features/0/entries/3/run/0/input/to'), /text\(\) can only be used in an automation entry's triggers and run/)
  assert.match(at('/features/0/entries/3/triggers/1/enabled'), /"trigger" can only be used in an automation entry's triggers and run/)
  assert.match(at('/features/0/entries/2/present/view/with/items'), /within\(\) can only be used/)
  assert.match(at('/features/0/settings/below/default'), /visible\(\) can only be used/)
  assert.equal(problems.length, 4, JSON.stringify(problems))
})

test('landed.<id> (a step\'s final URL and host) is accepted in http requests and step output only', async () => {
  const { checkPack } = await import('./check.mjs')
  const pack = JSON.parse(readFileSync(path.join(root, 'packs', 'official-translate.json'), 'utf8'))
  const ms = pack.providers.findIndex((p) => p.id === 'microsoft')
  const http = pack.providers[ms].implements.translate.http
  http.steps[0].output.base = '{{ landed.page.url }}'
  http.request.url = 'https://{{ landed.page.host }}/ttranslatev3'
  assert.deepEqual(checkPack(JSON.stringify(pack)), [])
  http.output.texts = '{{ [landed.page.host] }}'
  http.errors[0].message = '{{ landed.page.host }}'
  pack.providers[ms].hosts = ['{{ landed.page.host }}']
  pack.features[0].entries[0].run[1].input.to = '{{ landed.page.host }}'
  const problems = checkPack(JSON.stringify(pack))
  const base = `/providers/${ms}`
  for (const pointer of [`${base}/implements/translate/http/output/texts`, `${base}/implements/translate/http/errors/0/message`, `${base}/hosts/0`, '/features/0/entries/0/run/1/input/to']) {
    assert.match(problems.find((p) => p.path === pointer)?.message ?? '', /"landed" can only be used in an engine's http request and step output/, pointer)
  }
  assert.equal(problems.length, 4, JSON.stringify(problems))
})
