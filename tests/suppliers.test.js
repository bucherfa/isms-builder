'use strict'
const { createTestDataDir, removeTestDataDir } = require('./setup/testEnv')
const { loginAs, authedGet, authedPost, authedPut, authedDelete } = require('./setup/authHelper')

let dataDir, app, adminCookie, editorCookie, readerCookie
let supplierId

beforeAll(async () => {
  dataDir = createTestDataDir()
  process.env.DATA_DIR        = dataDir
  process.env.JWT_SECRET      = 'jest-test-secret-suppliers'
  process.env.NODE_ENV        = 'test'
  process.env.STORAGE_BACKEND = 'json'
  app = require('../server/index.js')

  adminCookie  = await loginAs(app, 'admin')
  editorCookie = await loginAs(app, 'editor')
  readerCookie = await loginAs(app, 'reader')
})

afterAll(async () => {
  removeTestDataDir(dataDir)
})

describe('Supplier CRUD', () => {
  test('GET /suppliers – leere Liste', async () => {
    const res = await authedGet(app, readerCookie, '/suppliers')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  test('GET /suppliers/summary – Zusammenfassung inkl. Triage-Zaehler', async () => {
    const res = await authedGet(app, readerCookie, '/suppliers/summary')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('total')
    expect(res.body).toHaveProperty('byTriageLevel')
    expect(res.body.byTriageLevel).toEqual({ low: 0, medium: 0, high: 0 })
    expect(res.body).toHaveProperty('triageUnassessed', 0)
  })

  test('reader darf NICHT erstellen (403)', async () => {
    const res = await authedPost(app, readerCookie, '/suppliers', { name: 'Test' })
    expect(res.status).toBe(403)
  })

  test('POST /suppliers – ohne triage: triageResult ist unassessed', async () => {
    const res = await authedPost(app, editorCookie, '/suppliers', {
      name: 'Ohne Triage GmbH', type: 'saas', criticality: 'medium',
    })
    expect(res.status).toBe(201)
    expect(res.body.triageResult).toEqual({ level: 'unassessed', axes: { pii: null, soc2: null, iso27001: null } })
  })

  test('POST /suppliers – Maximum-Prinzip: ein "high" macht den Lieferanten high', async () => {
    const res = await authedPost(app, editorCookie, '/suppliers', {
      name: 'Kritischer Cloud-Anbieter',
      type: 'cloud',
      criticality: 'critical',
      triage: {
        pii:      { processes: 'special' },
        soc2:     { status: 'na' },
        iso27001: { status: 'in_place' },
      },
    })
    expect(res.status).toBe(201)
    supplierId = res.body.id
    expect(res.body.triageResult.level).toBe('high')
    expect(res.body.triageResult.axes).toEqual({ pii: 'high', soc2: 'low', iso27001: 'low' })
  })

  test('SOC2 "na" zaehlt als low, nicht als unassessed', async () => {
    const res = await authedPost(app, editorCookie, '/suppliers', {
      name: 'SOC2-NA-Test', triage: { soc2: { status: 'na' } },
    })
    expect(res.status).toBe(201)
    expect(res.body.triageResult.axes.soc2).toBe('low')
    expect(res.body.triageResult.level).toBe('low')
  })

  test('POST /suppliers – unbekannter Enum-Wert wird mit 400 abgelehnt', async () => {
    const res = await authedPost(app, editorCookie, '/suppliers', {
      name: 'Ungueltig', triage: { pii: { processes: 'gibberish' } },
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/unbekannter Wert/)
  })

  test('PUT /suppliers/:id – partielles Triage-Update behaelt andere Achsen', async () => {
    const res = await authedPut(app, editorCookie, `/suppliers/${supplierId}`, {
      triage: { iso27001: { status: 'none' } },
    })
    expect(res.status).toBe(200)
    // pii war 'special' -> bleibt high, iso wechselt von in_place(low) auf none(high)
    expect(res.body.triage.pii.processes).toBe('special')
    expect(res.body.triageResult.axes.iso27001).toBe('high')
    expect(res.body.triageResult.level).toBe('high')
  })

  test('PUT /suppliers/:id – unbekannter Enum-Wert wird mit 400 abgelehnt', async () => {
    const res = await authedPut(app, editorCookie, `/suppliers/${supplierId}`, {
      triage: { soc2: { status: 'nonsense' } },
    })
    expect(res.status).toBe(400)
  })

  test('GET /suppliers?triage=high – Filter funktioniert', async () => {
    const res = await authedGet(app, readerCookie, '/suppliers?triage=high')
    expect(res.status).toBe(200)
    expect(res.body.every(s => s.triageResult.level === 'high')).toBe(true)
    expect(res.body.some(s => s.id === supplierId)).toBe(true)
  })

  test('GET /suppliers/summary – Zaehler spiegeln die angelegten Lieferanten', async () => {
    const res = await authedGet(app, readerCookie, '/suppliers/summary')
    expect(res.status).toBe(200)
    expect(res.body.byTriageLevel.high).toBeGreaterThanOrEqual(1)
    expect(res.body.byTriageLevel.low).toBeGreaterThanOrEqual(1)
    expect(res.body.triageUnassessed).toBeGreaterThanOrEqual(1)
  })

  test('DELETE /suppliers/:id – admin loescht (soft delete)', async () => {
    const res = await authedDelete(app, adminCookie, `/suppliers/${supplierId}`)
    expect(res.status).toBe(200)
  })
})
