'use strict'
// © 2026 Claude Hecker — ISMS Builder — AGPL-3.0
//
// Regressionstest fuer die trust-proxy-Haertung: ohne TRUST_PROXY duerfen
// X-Forwarded-*-Header von keinem Client beeinflusst werden koennen — weder
// die im Audit-Trail gespeicherte IP-Adresse einer Richtlinien-Bestaetigung
// (ackPublic.js) noch der Host/Protokoll im Link der Bestaetigungs-Mail
// (acknowledgements.js' buildTokenUrl). Mit bewusst gesetztem TRUST_PROXY
// muss der Header dagegen greifen — sonst waere die Option nutzlos.
const { createTestDataDir, removeTestDataDir } = require('./setup/testEnv')

jest.mock('../server/mailer', () => ({
  sendMail: jest.fn().mockResolvedValue(true),
  sendTestMail: jest.fn(),
  isConfigured: jest.fn().mockReturnValue(true),
  getSmtpConfig: jest.fn().mockReturnValue({}),
}))

function auth(request, app, role) {
  const creds = {
    admin:        ['admin@test.local',   'adminpass'],
    contentowner: ['co@test.local',      'copass'],
  }
  return request(app).post('/login').send({ email: creds[role][0], password: creds[role][1] })
    .then(r => r.headers['set-cookie'])
}

async function createApprovedTemplate(request, app, cookie) {
  const cr = await request(app).post('/template')
    .set('Cookie', cookie)
    .send({ type: 'policy', title: 'Trust-Proxy-Test-Richtlinie', language: 'de', content: 'x' })
  const id = cr.body.id
  await request(app).patch(`/template/policy/${id}/status`).set('Cookie', cookie).send({ status: 'review' })
  await request(app).patch(`/template/policy/${id}/status`).set('Cookie', cookie).send({ status: 'approved' })
  return id
}

describe('trust proxy AUS (Standard) — Header werden ignoriert', () => {
  let app, request, dataDir

  beforeAll(async () => {
    jest.resetModules()
    dataDir = createTestDataDir()
    process.env.DATA_DIR   = dataDir
    process.env.JWT_SECRET = 'jest-test-trustproxy-off'
    process.env.NODE_ENV   = 'test'
    process.env.STORAGE_BACKEND = 'json'
    delete process.env.TRUST_PROXY
    delete process.env.PUBLIC_URL
    app     = require('../server/index.js')
    request = require('supertest')
  })
  afterAll(() => removeTestDataDir(dataDir))

  test('gefaelschtes X-Forwarded-For landet NICHT im Audit-Trail', async () => {
    const adminCookie = await auth(request, app, 'admin')
    const coCookie     = await auth(request, app, 'contentowner')
    const templateId   = await createApprovedTemplate(request, app, adminCookie)
    await request(app).put('/admin/ack-settings').set('Cookie', adminCookie).send({ policyAckMode: 'email_campaign' })

    const dr = await request(app).post('/distributions').set('Cookie', coCookie)
      .send({ templateId, targetGroup: 'Test', emailList: ['victim@test.de'] })
    const distId = dr.body.id
    const acksRes = await request(app).get(`/distributions/${distId}/acks`).set('Cookie', coCookie)
    const token = acksRes.body[0].token

    await request(app).post(`/ack/${token}`)
      .set('X-Forwarded-For', '203.0.113.99') // gefaelschte, "offizielle" Test-IP (RFC 5737)
      .type('form').send({ recipientName: 'Opfer' })

    const after = await request(app).get(`/distributions/${distId}/acks`).set('Cookie', coCookie)
    const confirmed = after.body.find(a => a.token === token)
    expect(confirmed.ipAddress).not.toBe('203.0.113.99')
  })

  test('buildTokenUrl ignoriert X-Forwarded-Host/-Proto, benutzt den echten Verbindungs-Host', async () => {
    const mailer = require('../server/mailer')
    mailer.sendMail.mockClear()

    const adminCookie = await auth(request, app, 'admin')
    const coCookie     = await auth(request, app, 'contentowner')
    const templateId   = await createApprovedTemplate(request, app, adminCookie)
    await request(app).put('/admin/ack-settings').set('Cookie', adminCookie).send({ policyAckMode: 'email_campaign' })

    const dr = await request(app).post('/distributions')
      .set('Cookie', coCookie)
      .send({ templateId, targetGroup: 'Test', emailList: ['victim2@test.de'] })

    await request(app).post(`/distributions/${dr.body.id}/send`)
      .set('Cookie', coCookie)
      .set('X-Forwarded-Host', 'evil.example.com')
      .set('X-Forwarded-Proto', 'https')
      .send({})

    expect(mailer.sendMail).toHaveBeenCalled()
    const html = mailer.sendMail.mock.calls[0][2]
    expect(html).not.toContain('evil.example.com')
  })
})

describe('TRUST_PROXY gesetzt — Header werden bewusst respektiert', () => {
  let app, request, dataDir

  beforeAll(async () => {
    jest.resetModules()
    dataDir = createTestDataDir()
    process.env.DATA_DIR   = dataDir
    process.env.JWT_SECRET = 'jest-test-trustproxy-on'
    process.env.NODE_ENV   = 'test'
    process.env.STORAGE_BACKEND = 'json'
    process.env.TRUST_PROXY = '1'
    delete process.env.PUBLIC_URL
    app     = require('../server/index.js')
    request = require('supertest')
  })
  afterAll(() => {
    removeTestDataDir(dataDir)
    delete process.env.TRUST_PROXY
  })

  test('X-Forwarded-For wird bei aktivem TRUST_PROXY uebernommen', async () => {
    const adminCookie = await auth(request, app, 'admin')
    const coCookie     = await auth(request, app, 'contentowner')
    const templateId   = await createApprovedTemplate(request, app, adminCookie)
    await request(app).put('/admin/ack-settings').set('Cookie', adminCookie).send({ policyAckMode: 'email_campaign' })

    const dr = await request(app).post('/distributions').set('Cookie', coCookie)
      .send({ templateId, targetGroup: 'Test', emailList: ['real@test.de'] })
    const distId = dr.body.id
    const acksRes = await request(app).get(`/distributions/${distId}/acks`).set('Cookie', coCookie)
    const token = acksRes.body[0].token

    await request(app).post(`/ack/${token}`)
      .set('X-Forwarded-For', '203.0.113.50')
      .type('form').send({ recipientName: 'Echt' })

    const after = await request(app).get(`/distributions/${distId}/acks`).set('Cookie', coCookie)
    const confirmed = after.body.find(a => a.token === token)
    expect(confirmed.ipAddress).toBe('203.0.113.50')
  })
})

describe('PUBLIC_URL gesetzt — hat Vorrang vor allem anderen', () => {
  let app, request, dataDir

  beforeAll(async () => {
    jest.resetModules()
    dataDir = createTestDataDir()
    process.env.DATA_DIR   = dataDir
    process.env.JWT_SECRET = 'jest-test-publicurl'
    process.env.NODE_ENV   = 'test'
    process.env.STORAGE_BACKEND = 'json'
    delete process.env.TRUST_PROXY
    process.env.PUBLIC_URL = 'https://isms.example.com'
    app     = require('../server/index.js')
    request = require('supertest')
  })
  afterAll(() => {
    removeTestDataDir(dataDir)
    delete process.env.PUBLIC_URL
  })

  test('Bestaetigungs-Link benutzt PUBLIC_URL statt Request-Host', async () => {
    const mailer = require('../server/mailer')
    mailer.sendMail.mockClear()

    const adminCookie = await auth(request, app, 'admin')
    const coCookie     = await auth(request, app, 'contentowner')
    const templateId   = await createApprovedTemplate(request, app, adminCookie)
    await request(app).put('/admin/ack-settings').set('Cookie', adminCookie).send({ policyAckMode: 'email_campaign' })

    const dr = await request(app).post('/distributions')
      .set('Cookie', coCookie)
      .send({ templateId, targetGroup: 'Test', emailList: ['victim3@test.de'] })

    await request(app).post(`/distributions/${dr.body.id}/send`).set('Cookie', coCookie).send({})

    expect(mailer.sendMail).toHaveBeenCalled()
    const html = mailer.sendMail.mock.calls[0][2]
    expect(html).toContain('https://isms.example.com/ack/')
  })
})
