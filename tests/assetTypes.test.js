'use strict'
// Editierbare Asset-Typen (#64, Teil 1).
//
// Hintergrund: Die Typenliste stand vorher dreimal im Code — zweimal im
// Backend, einmal im Frontend — und war bereits auseinandergelaufen (Backend
// deutsch, Frontend englisch). Sie liegt jetzt einmal in
// server/db/assetTypes.js und wird über customListsStore editierbar gemacht.
//
// Die Tests decken drei Fehlerklassen ab, die dabei entstehen können:
//   1. eine kaputte Typenliste macht das Asset-Modul unbenutzbar,
//   2. ein gelöschter Typ lässt bestehende Assets ins Leere zeigen,
//   3. ein beliebiger Tippfehler landet als Typ in den Daten.

const fs   = require('fs')
const path = require('path')
const { createTestDataDir, removeTestDataDir } = require('./setup/testEnv')
const { loginAs, authedGet, authedPost, authedPut } = require('./setup/authHelper')

const assetTypes = require('../server/db/assetTypes')

let dataDir, app, adminCookie, editorCookie

beforeAll(async () => {
  dataDir = createTestDataDir()
  process.env.DATA_DIR        = dataDir
  process.env.JWT_SECRET      = 'jest-test-secret-assettypes'
  process.env.NODE_ENV        = 'test'
  process.env.STORAGE_BACKEND = 'json'
  app = require('../server/index.js')

  adminCookie  = await loginAs(app, 'admin')
  editorCookie = await loginAs(app, 'editor')
})

afterAll(async () => {
  removeTestDataDir(dataDir)
})

// ── Die einzige Deklaration ──────────────────────────────────────────────────
describe('assetTypes – Deklaration', () => {
  test('Vorgabe enthält alle 24 Typen mit gültiger Kategorie', () => {
    const types = assetTypes.defaults()
    expect(types).toHaveLength(24)
    for (const t of types) {
      expect(typeof t.id).toBe('string')
      expect(typeof t.label).toBe('string')
      expect(assetTypes.CATEGORY_IDS).toContain(t.category)
    }
  })

  test('defaults() gibt eine Kopie zurück, nicht die Konstante', () => {
    const a = assetTypes.defaults()
    a[0].label = 'verändert'
    expect(assetTypes.defaults()[0].label).not.toBe('verändert')
  })

  test('Typ-IDs sind eindeutig', () => {
    const ids = assetTypes.defaults().map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('die Liste steht nur noch an einer Stelle im Backend', () => {
    // Guard gegen den Rückfall in die Dreifach-Deklaration.
    const files = [
      'server/db/assetStore.js',
      'server/db/stores/assetStore.js',
      'ui/app.js',
    ]
    for (const rel of files) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
      expect(src).not.toMatch(/hardware_workstation:\s*'/)
    }
  })
})

// ── Übersetzung der Vorgabetypen ─────────────────────────────────────────────
//
// Übersetzt wird nur, was unverändert ausgeliefert wurde: assetTypeLabel()
// vergleicht das gespeicherte Label mit dem en-Wert des i18n-Schlüssels. Weicht
// einer davon ab, fällt die Übersetzung stillschweigend aus — der Nutzer sähe
// weiter Englisch, ohne dass etwas kaputtgeht. Genau deshalb dieser Guard.
describe('assetTypes – i18n', () => {
  const TRANSLATIONS = (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ui', 'i18n', 'translations.js'), 'utf8')
    const sandbox = { window: {} }
    // eslint-disable-next-line no-new-func
    new Function('window', src)(sandbox.window)
    return sandbox.window.TRANSLATIONS
  })()

  const LANGS = ['de', 'en', 'fr', 'nl']

  test.each(assetTypes.defaults().map(t => [t.id, t.label]))(
    'assetType_%s ist übersetzt und der en-Wert passt zur Vorgabe',
    (id, label) => {
      const entry = TRANSLATIONS[`assetType_${id}`]
      expect(entry).toBeDefined()
      for (const l of LANGS) {
        expect(typeof entry[l]).toBe('string')
        expect(entry[l].length).toBeGreaterThan(0)
      }
      // Die Invariante, auf der assetTypeLabel() beruht:
      expect(entry.en).toBe(label)
    }
  )

  test('jede Kategorie ist übersetzt', () => {
    for (const cat of assetTypes.CATEGORY_IDS) {
      const entry = TRANSLATIONS[`assetCat_${cat}`]
      expect(entry).toBeDefined()
      for (const l of LANGS) expect(typeof entry[l]).toBe('string')
    }
  })

  test('die Übersetzungen unterscheiden sich tatsächlich zwischen den Sprachen', () => {
    // Guard gegen versehentlich durchkopiertes Englisch.
    const entry = TRANSLATIONS['assetType_hardware_mobile']
    expect(entry.de).not.toBe(entry.en)
    expect(entry.fr).not.toBe(entry.en)
    expect(entry.nl).not.toBe(entry.en)
  })
})

// ── Validierung ──────────────────────────────────────────────────────────────
describe('assetTypes – Validierung', () => {
  const ok = [{ id: 'hardware_server', label: 'Server', category: 'hardware' }]

  test('gültige Liste passiert', () => {
    expect(assetTypes.validateTypes(ok).errors).toEqual([])
  })

  test.each([
    ['leere Liste',        []],
    ['kein Array',         { id: 'x' }],
  ])('%s wird abgelehnt', (_name, input) => {
    expect(assetTypes.validateTypes(input).errors.length).toBeGreaterThan(0)
  })

  test.each([
    ['Großbuchstaben in der ID', { id: 'Hardware', label: 'X', category: 'hardware' }],
    ['Leerzeichen in der ID',    { id: 'my type',  label: 'X', category: 'hardware' }],
    ['leeres Label',             { id: 'my_type',  label: '',  category: 'hardware' }],
    ['unbekannte Kategorie',     { id: 'my_type',  label: 'X', category: 'nonsense' }],
  ])('%s wird abgelehnt', (_name, entry) => {
    expect(assetTypes.validateTypes([entry]).errors.length).toBeGreaterThan(0)
  })

  test('doppelte IDs werden abgelehnt', () => {
    const res = assetTypes.validateTypes([...ok, ...ok])
    expect(res.errors.join(' ')).toMatch(/duplicate/)
  })
})

// ── Über die API ─────────────────────────────────────────────────────────────
describe('Asset-Typen über /admin/lists', () => {
  test('werden mit den übrigen Listen ausgeliefert', async () => {
    const res = await authedGet(app, adminCookie, '/admin/lists')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.assetTypes)).toBe(true)
    expect(res.body.assetTypes).toHaveLength(24)
  })

  test('ein eigener Typ lässt sich anlegen und wird verwendet', async () => {
    const types = [...assetTypes.defaults(), { id: 'data_crm', label: 'CRM Data', category: 'data' }]
    const put = await authedPut(app, adminCookie, '/admin/list/assetTypes', types)
    expect(put.status).toBe(200)

    const asset = await authedPost(app, editorCookie, '/assets', {
      name: 'Kundendaten', category: 'data', type: 'data_crm',
    })
    expect(asset.status).toBe(201)
    expect(asset.body.type).toBe('data_crm')
  })

  test('eine ungültige Liste wird mit 400 und Begründung abgewiesen', async () => {
    const res = await authedPut(app, adminCookie, '/admin/list/assetTypes',
      [{ id: 'Bad Id', label: 'X', category: 'hardware' }])
    expect(res.status).toBe(400)
    expect(Array.isArray(res.body.details)).toBe(true)
    expect(res.body.details.join(' ')).toMatch(/invalid id/)
  })

  test('ein Typ in Verwendung lässt sich nicht entfernen', async () => {
    // data_crm hängt am Asset aus dem Test oben.
    const withoutCrm = assetTypes.defaults()
    const res = await authedPut(app, adminCookie, '/admin/list/assetTypes', withoutCrm)
    expect(res.status).toBe(409)
    expect(res.body.inUse).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'data_crm', count: 1 })])
    )
  })

  test('ein unbenutzter Typ lässt sich entfernen', async () => {
    const types = [...assetTypes.defaults(), { id: 'data_crm', label: 'CRM Data', category: 'data' },
                   { id: 'data_scratch', label: 'Scratch', category: 'data' }]
    expect((await authedPut(app, adminCookie, '/admin/list/assetTypes', types)).status).toBe(200)

    const back = types.filter(t => t.id !== 'data_scratch')
    expect((await authedPut(app, adminCookie, '/admin/list/assetTypes', back)).status).toBe(200)
  })
})

// ── Typprüfung am Asset ──────────────────────────────────────────────────────
describe('Asset-Typ wird geprüft', () => {
  test('unbekannter Typ wird beim Anlegen abgelehnt', async () => {
    const res = await authedPost(app, editorCookie, '/assets', {
      name: 'Tippfehler', category: 'hardware', type: 'hadware_server',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Unknown asset type/)
  })

  test('unbekannter Typ wird beim Ändern abgelehnt', async () => {
    const created = await authedPost(app, editorCookie, '/assets', {
      name: 'Server 1', category: 'hardware', type: 'hardware_server',
    })
    expect(created.status).toBe(201)

    const res = await authedPut(app, editorCookie, `/assets/${created.body.id}`, { type: 'gibtsnicht' })
    expect(res.status).toBe(400)
  })

  test('leerer Typ bleibt erlaubt – Bestandsdaten haben ihn', async () => {
    const res = await authedPost(app, editorCookie, '/assets', { name: 'Ohne Typ', category: 'data' })
    expect(res.status).toBe(201)
  })
})
