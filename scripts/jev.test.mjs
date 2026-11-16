import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { evaluate } from '@marcbachmann/cel-js'

const pack = JSON.parse(readFileSync(fileURLToPath(new URL('../packs/official-llm.json', import.meta.url)), 'utf8'))
const jev = pack.providers.find((p) => p.id === 'jev').implements.choose.http

// Recorded from the real API (POST https://api.typesafe.ai/v1/systemone) for a choice question.
const response = {
  model: 'jev-1.14.0',
  answers: { choice: { type: 'choice', choice: 'yes', confidence: 1.0, probabilities: { yes: 1.0, no: 0.0 } } },
  usage: { input_tokens: 337, output_tokens: 31 }
}

const run = (template, scope) => evaluate(template.replace(/^\{\{([\s\S]*)\}\}$/, '$1'), scope)

test('Jev asks a choice question whose criteria are the choose options', () => {
  const question = jev.request.json.questions.choice
  assert.equal(question.type, 'choice')
  assert.equal(question.criteria, '{{ input.options }}')
  assert.equal(question.instructions, '{{ input.question }}')
})

test('Jev output maps the recorded choice answer to choice and confidence', () => {
  assert.equal(run(jev.output.choice, { response }), 'yes')
  assert.equal(run(jev.output.confidence, { response }), 1.0)
})
