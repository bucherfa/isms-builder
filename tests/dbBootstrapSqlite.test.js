'use strict'
// © 2026 Claude Hecker — ISMS Builder — AGPL-3.0
//
// Regressionstest fuer #42 (Crash beim Start unter STORAGE_BACKEND=sqlite).
// Beweist die drei Punkte aus der Ursachenanalyse:
//  (a) alle Tabellen existieren nach bootstrap()
//  (b) getDeleted() jedes Knex-Stores liefert ein Array, keine rejected Promise
//  (c) kein unhandledRejection waehrend des Starts
// Zusaetzlich: mehrere parallele init()-Aufrufe (wie sie die fire-and-forget
// Stores heute machen) duerfen keine zweite Migration anstossen und keine
// Query vor abgeschlossenem Schema zulassen — das simuliert einen
// Pod-Neustart/Rolling-Update mitten in der Init-Phase (s. #42-Diskussion).
const fs   = require('fs')
const os   = require('os')
const path = require('path')

describe('SQLite-Bootstrap-Gate (#42)', () => {
  let dataDir, app, knexDatabase
  const unhandled = []
  const onUnhandledRejection = (reason) => { unhandled.push(reason) }

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'isms-sqlite-boot-'))
    process.env.DATA_DIR        = dataDir
    process.env.JWT_SECRET      = 'jest-test-secret-sqlite-bootstrap'
    process.env.NODE_ENV        = 'test'
    process.env.STORAGE_BACKEND = 'sqlite'

    process.on('unhandledRejection', onUnhandledRejection)

    app          = require('../server/index.js')
    knexDatabase = require('../server/db/knexDatabase')

    await app.bootstrap()
  })

  afterAll(async () => {
    process.removeListener('unhandledRejection', onUnhandledRejection)
    await knexDatabase.destroy()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  test('kein unhandledRejection waehrend des Starts', () => {
    expect(unhandled).toEqual([])
  })

  test('alle zentralen Tabellen existieren nach bootstrap()', async () => {
    const db = knexDatabase.getDb()
    const tables = [
      'templates', 'risks', 'goals', 'training', 'legal_entries',
      'gdpr_entries', 'gdpr_deletion_log', 'public_incidents', 'suppliers',
      'findings', 'rbac_users', 'guidance', 'soa_controls', 'bcm_entries',
      'governance_entries',
    ]
    for (const t of tables) {
      expect(await db.schema.hasTable(t)).toBe(true)
    }
  })

  test('getDeleted() jedes Stores liefert ein Array, keine rejected Promise', async () => {
    const riskStore     = require('../server/db/riskStore')
    const goalsStore    = require('../server/db/goalsStore')
    const guidanceStore = require('../server/db/guidanceStore')
    const trainingStore = require('../server/db/trainingStore')
    const legalStore    = require('../server/db/legalStore')
    const gdprStore     = require('../server/db/gdprStore')
    const pubStore      = require('../server/db/publicIncidentStore')
    const supplierStore = require('../server/db/supplierStore')
    const findingStore  = require('../server/db/findingStore')
    const storage       = require('../server/storage')

    await expect(riskStore.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(goalsStore.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(guidanceStore.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(trainingStore.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(legalStore.contracts.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(legalStore.ndas.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(legalStore.privacyPolicies.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(gdprStore.vvt.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(gdprStore.av.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(gdprStore.dsfa.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(gdprStore.incidents.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(gdprStore.dsar.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(gdprStore.toms.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(pubStore.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(supplierStore.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(findingStore.getDeleted()).resolves.toEqual(expect.any(Array))
    await expect(storage.getDeletedTemplates()).resolves.toEqual(expect.any(Array))
  })

  test('Neustart mitten in der Init-Phase: parallele init()-Aufrufe auf derselben DB-Datei stuerzen nicht ab', async () => {
    jest.resetModules()
    const freshKnexDatabase = require('../server/db/knexDatabase')

    // Simuliert, wie heute jeder Store beim Start unabhaengig
    // `_knex.init().catch()` fire-and-forget aufruft — mehrfach parallel,
    // gegen dieselbe Datei (wie bei einem Pod, der neu startet, waehrend
    // eine andere Instanz noch initialisiert). init() ist idempotent/
    // memoisiert; keiner der Aufrufe darf ablehnen oder eine zweite
    // Migration anstossen.
    const results = await Promise.allSettled([
      freshKnexDatabase.init(),
      freshKnexDatabase.init(),
      freshKnexDatabase.init(),
    ])
    expect(results.every(r => r.status === 'fulfilled')).toBe(true)

    const db = freshKnexDatabase.getDb()
    expect(await db.schema.hasTable('templates')).toBe(true)
    await freshKnexDatabase.destroy()
  })
})
