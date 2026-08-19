'use strict'
const { createTestDataDir, removeTestDataDir } = require('./setup/testEnv')
const { loginAs, authedGet } = require('./setup/authHelper')

let dataDir, app, adminCookie, readerCookie
let originalFetch

beforeAll(async () => {
  dataDir = createTestDataDir()
  process.env.DATA_DIR        = dataDir
  process.env.JWT_SECRET      = 'jest-test-secret-updatecheck'
  process.env.NODE_ENV        = 'test'
  process.env.STORAGE_BACKEND = 'json'
  app = require('../server/index.js')

  adminCookie  = await loginAs(app, 'admin')
  readerCookie = await loginAs(app, 'reader')
})

afterAll(async () => {
  removeTestDataDir(dataDir)
})

beforeEach(() => {
  originalFetch = global.fetch
})
afterEach(() => {
  global.fetch = originalFetch
})

function mockFetchOnce(status, body) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

describe('server/updateCheck.js', () => {
  test('meldet updateAvailable:true bei neuerer GitHub-Version', async () => {
    jest.resetModules()
    mockFetchOnce(200, { tag_name: 'v9.9.9', html_url: 'https://github.com/coolstartnow/isms-builder/releases/tag/v9.9.9' })
    const { checkForUpdate } = require('../server/updateCheck')
    const result = await checkForUpdate(true)
    expect(result.ok).toBe(true)
    expect(result.updateAvailable).toBe(true)
    expect(result.latestVersion).toBe('9.9.9')
  })

  test('meldet updateAvailable:false wenn Version identisch ist', async () => {
    jest.resetModules()
    const pkg = require('../package.json')
    mockFetchOnce(200, { tag_name: `v${pkg.version}`, html_url: 'https://example.com' })
    const { checkForUpdate } = require('../server/updateCheck')
    const result = await checkForUpdate(true)
    expect(result.ok).toBe(true)
    expect(result.updateAvailable).toBe(false)
  })

  test('wirft nie: liefert ok:false bei GitHub-Fehlerantwort', async () => {
    jest.resetModules()
    mockFetchOnce(403, {})
    const { checkForUpdate } = require('../server/updateCheck')
    const result = await checkForUpdate(true)
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.currentVersion).toBeTruthy()
  })

  test('wirft nie: liefert ok:false bei Netzwerkfehler', async () => {
    jest.resetModules()
    global.fetch = jest.fn().mockRejectedValue(new Error('Netzwerk nicht erreichbar'))
    const { checkForUpdate } = require('../server/updateCheck')
    const result = await checkForUpdate(true)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/nicht erreichbar/)
  })
})

describe('GET /admin/update-check', () => {
  test('reader darf NICHT zugreifen (403)', async () => {
    const res = await authedGet(app, readerCookie, '/admin/update-check')
    expect(res.status).toBe(403)
  })

  test('admin bekommt ein Ergebnisobjekt mit currentVersion (?force=true umgeht den Cache)', async () => {
    mockFetchOnce(200, { tag_name: `v${require('../package.json').version}`, html_url: 'https://example.com' })
    const res = await authedGet(app, adminCookie, '/admin/update-check?force=true')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('currentVersion')
    expect(res.body.currentVersion).toBe(require('../package.json').version)
    expect(res.body.updateAvailable).toBe(false)
  })
})
