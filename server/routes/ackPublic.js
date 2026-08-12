// © 2026 Claude Hecker — ISMS Builder — AGPL-3.0
// Public Policy Acknowledgement — token-based, no login required

const express  = require('express')
const router   = express.Router()
const ackStore = require('../db/ackStore')
const storage  = require('../storage')

// ── GET /ack/:token — Bestätigungsseite anzeigen ──────────────────────────────
router.get('/ack/:token', async (req, res) => {
  // Nie aus dem Cache: Inhalt und Bestaetigungsstand koennen sich aendern.
  res.setHeader('Cache-Control', 'no-store')
  const ack  = await ackStore.getAckByToken(req.params.token)
  if (!ack) {
    return res.status(404).send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
      <title>ISMS Builder</title></head><body style="font-family:sans-serif;max-width:600px;margin:60px auto;padding:20px">
      <h2>Link ungültig</h2>
      <p>Dieser Bestätigungslink ist nicht gültig oder wurde bereits verwendet.</p>
      </body></html>`)
  }

  const dist = await ackStore.getDistribution(ack.distributionId)
  if (!dist) return res.status(404).send('Verteilrunde nicht gefunden')

  // Policy-Inhalt laden
  let policyContent = ''
  let policyTitle   = dist.templateTitle
  try {
    const all   = await storage.getTemplates({}) || []
    const tmpl  = all.find(t => t.id === dist.templateId)
    if (tmpl) {
      policyTitle   = tmpl.title   || dist.templateTitle
      policyContent = tmpl.content || ''
    }
  } catch {}

  const alreadyConfirmed = Boolean(ack.acknowledgedAt)
  const dueDateHtml = dist.dueDate
    ? `<p class="due">Bitte bestätigen bis: <strong>${new Date(dist.dueDate).toLocaleDateString('de-DE')}</strong></p>`
    : ''

  const confirmedHtml = alreadyConfirmed ? `
    <div class="confirmed-banner">
      <span>&#10003;</span> Sie haben diese Richtlinie bereits am
      ${new Date(ack.acknowledgedAt).toLocaleString('de-DE')} bestätigt.
    </div>` : ''

  const formHtml = alreadyConfirmed ? '' : `
    <form method="POST" action="/ack/${req.params.token}" class="ack-form">
      <label for="recipientName">Ihr Name (optional):</label>
      <input type="text" id="recipientName" name="recipientName" placeholder="Vor- und Nachname" />
      <button type="submit" class="btn-confirm">
        &#10003;&nbsp; Ich habe diese Richtlinie gelesen und verstanden
      </button>
    </form>`

  res.send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Richtlinie bestätigen – ISMS Builder</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f4f5f7; color: #172b4d; margin: 0; padding: 20px; }
    .card { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.12);
            max-width: 760px; margin: 40px auto; padding: 40px; }
    .logo { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; color: #0052cc; }
    .logo svg { width: 28px; height: 28px; }
    .logo span { font-size: 18px; font-weight: 700; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    .meta { color: #5e6c84; font-size: 13px; margin-bottom: 16px; }
    .due { background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px 14px;
           border-radius: 4px; margin-bottom: 20px; }
    .policy-content { background: #f8f9fa; border: 1px solid #dfe1e6; border-radius: 6px;
                      padding: 20px; max-height: 400px; overflow-y: auto;
                      font-size: 14px; line-height: 1.7; margin-bottom: 24px;
                      word-wrap: break-word; }
    .policy-content h1 { font-size: 19px; margin: 0 0 10px; }
    .policy-content h2 { font-size: 16px; margin: 18px 0 8px; }
    .policy-content h3 { font-size: 14.5px; margin: 14px 0 6px; }
    .policy-content ul, .policy-content ol { padding-left: 22px; }
    .policy-content table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
    .policy-content th, .policy-content td { border: 1px solid #dfe1e6; padding: 5px 8px; text-align: left; }
    .policy-content th { background: #eef1f4; }
    .policy-content pre { background: #eef1f4; padding: 10px; border-radius: 4px; overflow-x: auto; }
    .policy-content code { background: #eef1f4; padding: 1px 4px; border-radius: 3px; }
    .policy-content blockquote { border-left: 3px solid #dfe1e6; margin: 10px 0; padding: 2px 0 2px 12px; color: #5e6c84; }
    .confirmed-banner { background: #e3fcef; border: 1px solid #abf5d1; border-radius: 6px;
                        padding: 16px 20px; color: #006644; font-weight: 600; margin-bottom: 16px; }
    .ack-form label { display: block; font-weight: 600; margin-bottom: 6px; }
    .ack-form input { width: 100%; padding: 10px 12px; border: 2px solid #dfe1e6;
                      border-radius: 4px; font-size: 15px; margin-bottom: 16px; }
    .btn-confirm { background: #0052cc; color: #fff; border: none; padding: 14px 28px;
                   border-radius: 4px; font-size: 16px; font-weight: 600; cursor: pointer;
                   width: 100%; }
    .btn-confirm:hover { background: #0065ff; }
    .footer { text-align: center; color: #97a0af; font-size: 12px; margin-top: 28px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      <span>ISMS Builder</span>
    </div>

    <h1>${escapeHtml(policyTitle)}</h1>
    <div class="meta">Version ${dist.templateVersion} &middot; Typ: ${escapeHtml(dist.templateType)}</div>

    ${dueDateHtml}
    ${confirmedHtml}

    <div class="policy-content" id="policyContent"></div>

    ${formHtml}

    <div class="footer">ISMS Builder &mdash; automatisch generierter Bestätigungslink</div>
  </div>

  <script src="/ui/vendor/marked.min.js"></script>
  <script>
    // #61: Bis hierher stand die Richtlinie als Rohtext auf dieser Seite —
    // Empfänger bestätigten also "## Überschrift" gelesen zu haben.
    //
    // Gerendert wird im Browser mit der ohnehin vorhandenen Bibliothek; der
    // Server bleibt ohne zusätzliche Abhängigkeit. Spitze Klammern werden
    // vorher entschärft (kein eingebettetes HTML) und javascript:-Verweise
    // nachträglich entfernt: Diese Seite ist ohne Login erreichbar, der Inhalt
    // stammt aus dem Redaktionssystem.
    (function () {
      var raw = ${JSON.stringify(policyContent || '')};
      var box = document.getElementById('policyContent');
      if (!raw) { box.innerHTML = '<em>Kein Inhalt verfügbar.</em>'; return; }
      if (typeof marked === 'undefined') {
        var pre = document.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        pre.textContent = raw;
        box.appendChild(pre);
        return;
      }
      box.innerHTML = marked.parse(raw.replace(/</g, '&lt;'));
      box.querySelectorAll('a[href]').forEach(function (a) {
        if (/^\s*javascript:/i.test(a.getAttribute('href') || '')) a.removeAttribute('href');
        else { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      });
    })();
  <\/script>
</body>
</html>`)
})

// ── POST /ack/:token — Bestätigung speichern ──────────────────────────────────
router.post('/ack/:token', express.urlencoded({ extended: false }), async (req, res) => {
  // req.ip statt eines rohen X-Forwarded-For-Reads: respektiert 'trust proxy'
  // (s. server/index.js) — ohne aktiviertes TRUST_PROXY koennte ein Client den
  // Header sonst selbst mitschicken und die hier gespeicherte IP faelschen.
  const ip   = req.ip || ''
  const name = (req.body.recipientName || '').trim().slice(0, 200)

  const ack = await ackStore.confirmByToken(req.params.token, { recipientName: name, ipAddress: ip })
  if (!ack) {
    return res.status(404).send(`<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
      <title>ISMS Builder</title></head><body style="font-family:sans-serif;max-width:600px;margin:60px auto;padding:20px">
      <h2>Link ungültig</h2><p>Dieser Link ist nicht mehr gültig.</p></body></html>`)
  }

  const dist = await ackStore.getDistribution(ack.distributionId) || {}

  res.send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bestätigung erfolgreich – ISMS Builder</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f4f5f7; color: #172b4d; margin: 0; padding: 20px; }
    .card { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.12);
            max-width: 600px; margin: 80px auto; padding: 48px; text-align: center; }
    .check { font-size: 64px; color: #00875a; margin-bottom: 20px; }
    h1 { font-size: 24px; margin-bottom: 12px; }
    p { color: #5e6c84; }
    .footer { color: #97a0af; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">&#10003;</div>
    <h1>Vielen Dank!</h1>
    <p>Sie haben die Richtlinie <strong>${escapeHtml(dist.templateTitle || '')}</strong> erfolgreich bestätigt.</p>
    <p>Ihre Bestätigung wurde am <strong>${new Date(ack.acknowledgedAt).toLocaleString('de-DE')}</strong> gespeichert.</p>
    <div class="footer">ISMS Builder &mdash; diese Seite kann geschlossen werden.</div>
  </div>
</body>
</html>`)
})

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

module.exports = router
