'use strict'
const http = require('http')
const { createTestDataDir, removeTestDataDir } = require('./setup/testEnv')
const { loginAs, authedGet, authedPost, authedPut } = require('./setup/authHelper')

let dataDir, app, adminCookie, contentownerCookie, editorCookie
let stubServer, stubPort, stubRequests

// Minimaler WebDAV-Stub: beantwortet PROPFIND/MKCOL/PUT mit Basic-Auth-Pruefung,
// wie Issue #66 es verlangt ("Tests gegen Stub-WebDAV-Server, nicht gegen eine
// echte Nextcloud-Instanz"). Ein echter Server wird nur in der separaten
// Docker-Verifikation (#23) angefasst.
function startStubServer() {
  const expectedAuth = 'Basic ' + Buffer.from('tester:app-pw-123').toString('base64')
  return new Promise((resolve) => {
    stubRequests = []
    stubServer = http.createServer((req, res) => {
      stubRequests.push(`${req.method} ${req.url}`)
      if (req.headers.authorization !== expectedAuth) { res.writeHead(401); res.end(); return }
      if (req.method === 'PROPFIND')  { res.writeHead(207, { 'Content-Type': 'application/xml' }); res.end('<d:multistatus/>'); return }
      if (req.method === 'MKCOL')     { res.writeHead(201); res.end(); return }
      if (req.method === 'PROPPATCH') { res.writeHead(207, { 'Content-Type': 'application/xml' }); res.end('<d:multistatus/>'); return }
      if (req.method === 'PUT') {
        const chunks = []
        req.on('data', c => chunks.push(c))
        req.on('end', () => { res.writeHead(201); res.end() })
        return
      }
      if (req.method === 'POST' && req.url.includes('/ocs/v2.php/apps/files_sharing/api/v1/shares')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ocs: { data: { url: `http://127.0.0.1:${stubPort}/s/stubtoken` } } }))
        return
      }
      res.writeHead(404); res.end()
    })
    stubServer.listen(0, () => { stubPort = stubServer.address().port; resolve() })
  })
}

beforeAll(async () => {
  dataDir = createTestDataDir()
  process.env.DATA_DIR        = dataDir
  process.env.JWT_SECRET      = 'jest-test-secret-webdav'
  process.env.NODE_ENV        = 'test'
  process.env.STORAGE_BACKEND = 'json'
  app = require('../server/index.js')

  adminCookie         = await loginAs(app, 'admin')
  contentownerCookie  = await loginAs(app, 'contentowner')
  editorCookie        = await loginAs(app, 'editor')

  await startStubServer()
})

afterAll(async () => {
  await new Promise(r => stubServer.close(r))
  removeTestDataDir(dataDir)
})

describe('server/pdfExport.js', () => {
  const { renderTemplateToPdf } = require('../server/pdfExport')

  test('erzeugt einen gueltigen PDF-Buffer', async () => {
    const buf = await renderTemplateToPdf({
      title: 'Testrichtlinie', type: 'policy', status: 'approved', version: 2, owner: 'IT',
      content: '# Ueberschrift\n\nEin Absatz mit **fett** und *kursiv*.\n\n- Punkt 1\n- Punkt 2\n\n| A | B |\n|---|---|\n| 1 | 2 |',
    })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.slice(0, 5).toString()).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(500)
  })

  test('kommt mit leerem Inhalt klar', async () => {
    const buf = await renderTemplateToPdf({ title: 'Leer', content: '' })
    expect(buf.slice(0, 5).toString()).toBe('%PDF-')
  })
})

describe('server/webdav.js gegen Stub-Server', () => {
  const webdav = require('../server/webdav')

  function cfg(extra = {}) {
    return { baseUrl: `http://127.0.0.1:${stubPort}/remote.php/dav/files/tester`, username: 'tester', appPassword: 'app-pw-123', folder: 'ISMS-Richtlinien', ...extra }
  }

  test('testConnection: Erfolg mit korrekten Zugangsdaten', async () => {
    const result = await webdav.testConnection(cfg())
    expect(result.ok).toBe(true)
  })

  test('testConnection: Fehler bei falschem App-Passwort', async () => {
    const result = await webdav.testConnection(cfg({ appPassword: 'wrong' }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Anmeldung/i)
  })

  test('testConnection: Fehler bei fehlenden Pflichtfeldern', async () => {
    const result = await webdav.testConnection({ baseUrl: '' })
    expect(result.ok).toBe(false)
  })

  test('ensureFolder + putFile funktionieren gegen den Stub', async () => {
    await expect(webdav.ensureFolder(cfg())).resolves.toBe(true)
    await expect(webdav.putFile(cfg(), 'test.txt', Buffer.from('hallo'), 'text/plain')).resolves.toBe(true)
  })

  test('publishDocument liefert ok:false ohne Konfiguration statt zu werfen', async () => {
    const result = await webdav.publishDocument({ title: 'X', content: '# X' })
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
  })

  test('markFolderFavorite funktioniert gegen den Stub (PROPPATCH)', async () => {
    await expect(webdav.markFolderFavorite(cfg())).resolves.toBe(true)
  })

  test('createShareLink liefert die vom Stub gelieferte URL', async () => {
    await expect(webdav.createShareLink(cfg())).resolves.toBe(`http://127.0.0.1:${stubPort}/s/stubtoken`)
  })
})

describe('Sichtbarkeits-Extras ueber .env-Schalter', () => {
  const webdav = require('../server/webdav')
  function cfg(extra = {}) {
    return { baseUrl: `http://127.0.0.1:${stubPort}/remote.php/dav/files/tester`, username: 'tester', appPassword: 'app-pw-123', folder: 'ISMS-Richtlinien', ...extra }
  }

  afterEach(() => {
    delete process.env.WEBDAV_MARK_FAVORITE
    delete process.env.WEBDAV_CREATE_SHARE_LINK
  })

  test('ohne gesetzte env-Variablen: kein shareLink im Ergebnis', async () => {
    const orgSettingsStore = require('../server/db/orgSettingsStore')
    await orgSettingsStore.update({ webdavSettings: { enabled: true, ...cfg() } })
    const result = await webdav.publishDocument({ title: 'Extras-Test-Aus', content: '# X' })
    expect(result.ok).toBe(true)
    expect(result.shareLink).toBeUndefined()
  })

  test('WEBDAV_CREATE_SHARE_LINK=true: shareLink landet im Ergebnis, Publish bleibt gueltig', async () => {
    process.env.WEBDAV_CREATE_SHARE_LINK = 'true'
    const orgSettingsStore = require('../server/db/orgSettingsStore')
    await orgSettingsStore.update({ webdavSettings: { enabled: true, ...cfg() } })
    const result = await webdav.publishDocument({ title: 'Extras-Test-An', content: '# X' })
    expect(result.ok).toBe(true)
    expect(result.shareLink).toBe(`http://127.0.0.1:${stubPort}/s/stubtoken`)
  })

  test('WEBDAV_MARK_FAVORITE=true: Publish bleibt gueltig, PROPPATCH wird ausgefuehrt', async () => {
    process.env.WEBDAV_MARK_FAVORITE = 'true'
    const orgSettingsStore = require('../server/db/orgSettingsStore')
    await orgSettingsStore.update({ webdavSettings: { enabled: true, ...cfg() } })
    stubRequests.length = 0
    const result = await webdav.publishDocument({ title: 'Extras-Test-Favorit', content: '# X' })
    expect(result.ok).toBe(true)
    expect(stubRequests.some(r => r.startsWith('PROPPATCH'))).toBe(true)
  })
})

describe('Routen: Auto-Publish, Re-Sync, Verbindungstest', () => {
  let templateId

  test('POST /admin/webdav/test – Verbindungstest ueber die Route', async () => {
    const res = await authedPost(app, adminCookie, '/admin/webdav/test', {
      baseUrl: `http://127.0.0.1:${stubPort}/remote.php/dav/files/tester`,
      username: 'tester', appPassword: 'app-pw-123', folder: 'ISMS-Richtlinien',
    })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  test('WebDAV-Einstellungen speichern und aktivieren', async () => {
    const res = await authedPut(app, adminCookie, '/admin/org-settings', {
      webdavSettings: {
        enabled: true,
        baseUrl: `http://127.0.0.1:${stubPort}/remote.php/dav/files/tester`,
        username: 'tester', appPassword: 'app-pw-123', folder: 'ISMS-Richtlinien',
      },
    })
    expect(res.status).toBe(200)
    expect(res.body.webdavSettings.enabled).toBe(true)
  })

  test('Template anlegen und bis "approved" durchreichen', async () => {
    const create = await authedPost(app, contentownerCookie, '/template', {
      type: 'policy', language: 'de', title: 'WebDAV-Test-Richtlinie',
      content: '# Testinhalt', owner: 'IT',
    })
    expect(create.status).toBe(201)
    templateId = create.body.id

    const toReview = await require('supertest')(app)
      .patch(`/template/policy/${templateId}/status`)
      .set('Cookie', editorCookie)
      .send({ status: 'review' })
    expect(toReview.status).toBe(200)

    const toApproved = await require('supertest')(app)
      .patch(`/template/policy/${templateId}/status`)
      .set('Cookie', contentownerCookie)
      .send({ status: 'approved' })
    expect(toApproved.status).toBe(200)
    expect(toApproved.body.status).toBe('approved')
  })

  test('Auto-Publish lief fire-and-forget und landet im webdav_publish-Feld', async () => {
    // fire-and-forget: kurz warten, bis der Hintergrund-Promise durchgelaufen ist
    await new Promise(r => setTimeout(r, 300))
    const res = await authedGet(app, editorCookie, `/template/policy/${templateId}`)
    expect(res.status).toBe(200)
    expect(res.body.webdavPublish).toBeTruthy()
    expect(res.body.webdavPublish.ok).toBe(true)
    expect(stubRequests.some(r => r.includes('PUT') && r.includes('.pdf'))).toBe(true)
  })

  test('POST /template/:type/:id/publish-webdav – manueller Re-Sync', async () => {
    const res = await authedPost(app, editorCookie, `/template/policy/${templateId}/publish-webdav`, {})
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.template.webdavPublish.ok).toBe(true)
  })

  test('Re-Sync liefert ok:false, wenn WebDAV deaktiviert ist, statt zu werfen', async () => {
    await authedPut(app, adminCookie, '/admin/org-settings', { webdavSettings: { enabled: false } })
    const res = await require('supertest')(app)
      .post(`/template/policy/${templateId}/publish-webdav`)
      .set('Cookie', editorCookie)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(false)
  })
})
