// © 2026 Claude Hecker — ISMS Builder — AGPL-3.0
/**
 * webdav.js – Nextcloud/ownCloud-Publish fuer freigegebene Richtlinien (#66).
 *
 * Nextcloud und ownCloud sprechen beide WebDAV — kein SDK noetig. PUT, GET,
 * MKCOL und PROPFIND funktionieren mit Node's eingebautem fetch plus Basic
 * Auth. Bewusst keine neue Abhaengigkeit dafuer (das Projekt haelt sich
 * bewusst schlank).
 *
 * Konfiguration liegt bei den SMTP-Einstellungen (org-settings.json /
 * org_settings-Tabelle, Schluessel webdavSettings) — das Passwort landet dort
 * im Klartext, exakt wie das SMTP-Passwort heute. Fuer Nextcloud laesst sich
 * das entschaerfen: ein App-Passwort statt des Hauptkonto-Passworts ist
 * einzeln widerrufbar und hat keinen Zugriff auf das Hauptkonto. Die
 * Admin-UI soll das nicht nur erlauben, sondern verlangen und erklaeren
 * (s. Issue #66).
 *
 * Ausfall des Remote-Systems darf nie zum ISMS-Problem werden: publishDocument()
 * wirft nie, sondern liefert immer {ok, error}. Das freigegebene Dokument
 * bleibt freigegeben, auch wenn Nextcloud gerade nicht erreichbar ist — der
 * Fehler ist sichtbar (webdav_publish-Feld am Template) und der Re-Sync-Button
 * erlaubt einen erneuten Versuch, ohne den Freigabezyklus zu wiederholen.
 *
 * Nur PDF wird hochgeladen — ein testweise mitgeladenes HTML-Pendant zeigte
 * Nextcloud im Browser lediglich als Rohtext an (kein Viewer dafuer), war also
 * ungenutzt totes Gewicht.
 *
 * Zwei optionale Sichtbarkeits-Extras, je per .env schaltbar (Default: aus,
 * um den Basisfall aus Issue #66 nicht mit Nextcloud-spezifischem Verhalten
 * zu belasten):
 *   WEBDAV_MARK_FAVORITE=true    – markiert den Zielordner per WebDAV-Property
 *                                  (oc:favorite) als Favorit, taucht dann bei
 *                                  jedem Nutzer mit Zugriff unter
 *                                  Dateien > Favoriten weiter oben auf.
 *   WEBDAV_CREATE_SHARE_LINK=true – legt ueber die OCS-Share-API einen
 *                                  oeffentlichen Lesezugriffs-Link auf die
 *                                  hochgeladene PDF an; der Link landet im
 *                                  webdav_publish-Feld und wird im
 *                                  Template-Editor angezeigt.
 * Beide sind rein additiv: schlagen sie fehl, bleibt der eigentliche Publish
 * (PDF hochgeladen) trotzdem erfolgreich — nur eine Konsolenwarnung.
 */

const { renderTemplateToPdf } = require('./pdfExport')

function _authHeader(cfg) {
  return 'Basic ' + Buffer.from(`${cfg.username}:${cfg.appPassword}`).toString('base64')
}

/** Verbindet baseUrl + Ordner + Dateiname ohne doppelte/fehlende Schraegstriche. */
function _joinUrl(...parts) {
  return parts
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .map((p, i) => {
      let seg = p.replace(/\/+$/, '')
      if (i > 0) seg = seg.replace(/^\/+/, '')
      return seg
    })
    .join('/')
}

/** Liest die aktuelle WebDAV-Konfiguration aus org-settings. Liefert null, wenn nicht aktiviert/konfiguriert. */
async function getConfig() {
  try {
    const orgSettings = require('./db/orgSettingsStore')
    const s = await orgSettings.get()
    const w = s.webdavSettings || {}
    if (!w.enabled || !w.baseUrl || !w.username || !w.appPassword) return null
    return {
      enabled: true,
      baseUrl: w.baseUrl,
      username: w.username,
      appPassword: w.appPassword,
      folder: w.folder || 'ISMS-Richtlinien',
    }
  } catch {
    return null
  }
}

/** MKCOL auf den Zielordner — idempotent: 405/409 (existiert bereits) zaehlt als Erfolg. */
async function ensureFolder(cfg) {
  const url = _joinUrl(cfg.baseUrl, cfg.folder)
  const res = await fetch(url, { method: 'MKCOL', headers: { Authorization: _authHeader(cfg) } })
  if (res.ok || res.status === 405 || res.status === 409) return true
  throw new Error(`MKCOL fehlgeschlagen (${res.status} ${res.statusText})`)
}

/** Laedt eine Datei per PUT in den Zielordner hoch. */
async function putFile(cfg, filename, buffer, contentType) {
  const url = _joinUrl(cfg.baseUrl, cfg.folder, filename)
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: _authHeader(cfg), 'Content-Type': contentType },
    body: buffer,
  })
  if (!res.ok) throw new Error(`PUT ${filename} fehlgeschlagen (${res.status} ${res.statusText})`)
  return true
}

/**
 * Verbindungstest fuer die Admin-UI: PROPFIND auf die Basis-URL (Depth 0 —
 * keine Ordnerliste noetig, nur pruefen ob Server + Zugangsdaten stimmen).
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
async function testConnection(cfg) {
  if (!cfg || !cfg.baseUrl || !cfg.username || !cfg.appPassword) {
    return { ok: false, error: 'Basis-URL, Benutzername und App-Passwort sind erforderlich' }
  }
  try {
    const res = await fetch(cfg.baseUrl, {
      method: 'PROPFIND',
      headers: { Authorization: _authHeader(cfg), Depth: '0', 'Content-Type': 'application/xml' },
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
    })
    if (res.status === 207 || res.ok) {
      await ensureFolder(cfg)
      return { ok: true }
    }
    if (res.status === 401) return { ok: false, error: 'Anmeldung fehlgeschlagen (Benutzername/App-Passwort prüfen)' }
    if (res.status === 404) return { ok: false, error: 'Basis-URL nicht gefunden (404)' }
    return { ok: false, error: `Unerwartete Antwort: ${res.status} ${res.statusText}` }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

function _pdfFilename(doc) {
  const safe = String(doc.title || doc.id || 'dokument').replace(/[^a-zA-Z0-9äöüÄÖÜß _.-]/g, '').trim() || 'dokument'
  return `${safe}.pdf`
}

/** Serverwurzel aus der WebDAV-baseUrl ableiten (…/remote.php/dav/files/user → https://host). Fuer die OCS-Share-API, die serverrelativ arbeitet. */
function _originOf(baseUrl) {
  return new URL(baseUrl).origin
}

/** Markiert den Zielordner als Favorit (WebDAV PROPPATCH, oc:favorite). Wirft bei Fehlschlag — Aufrufer faengt ab, damit ein Fehlschlag hier den eigentlichen Publish nicht verdirbt. */
async function markFolderFavorite(cfg) {
  const url = _joinUrl(cfg.baseUrl, cfg.folder)
  const body = `<?xml version="1.0"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:set><d:prop><oc:favorite>1</oc:favorite></d:prop></d:set>
</d:propertyupdate>`
  const res = await fetch(url, {
    method: 'PROPPATCH',
    headers: { Authorization: _authHeader(cfg), 'Content-Type': 'application/xml' },
    body,
  })
  if (res.status !== 207) throw new Error(`PROPPATCH (Favorit) fehlgeschlagen (${res.status} ${res.statusText})`)
  return true
}

/** Legt per OCS-Share-API einen oeffentlichen Lesezugriffs-Link auf den Zielordner an und liefert die URL. */
async function createShareLink(cfg) {
  const origin = _originOf(cfg.baseUrl)
  const path = '/' + cfg.folder.replace(/^\/+|\/+$/g, '')
  const res = await fetch(`${origin}/ocs/v2.php/apps/files_sharing/api/v1/shares`, {
    method: 'POST',
    headers: {
      Authorization: _authHeader(cfg),
      'OCS-APIREQUEST': 'true',
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ path, shareType: '3', permissions: '1' }),
  })
  if (!res.ok) throw new Error(`Share-Link-Erstellung fehlgeschlagen (${res.status} ${res.statusText})`)
  const data = await res.json()
  const url = data?.ocs?.data?.url
  if (!url) throw new Error('Share-Link-Antwort enthielt keine URL')
  return url
}

/**
 * Rendert das Template-Dokument als PDF und laedt es in den konfigurierten
 * Nextcloud/ownCloud-Ordner hoch. Wirft nie — Ausfall des Remote-Systems ist
 * ein Ergebnis (ok:false), kein Absturz. Favorit-Markierung und Share-Link
 * sind rein additive Sichtbarkeits-Extras (s. Modulkommentar) und beeinflussen
 * ok/error nicht, wenn der eigentliche PDF-Upload geklappt hat.
 * @param {{id, title, type, status, version, owner, nextReviewDate, content}} doc
 * @returns {Promise<{ok:boolean, error?:string, publishedAt?:string, shareLink?:string}>}
 */
async function publishDocument(doc) {
  try {
    const cfg = await getConfig()
    if (!cfg) return { ok: false, error: 'WebDAV-Publish ist nicht konfiguriert oder deaktiviert' }

    const pdfBuf = await renderTemplateToPdf(doc)

    await ensureFolder(cfg)
    await putFile(cfg, _pdfFilename(doc), pdfBuf, 'application/pdf')

    const result = { ok: true, publishedAt: new Date().toISOString() }

    if (String(process.env.WEBDAV_MARK_FAVORITE).toLowerCase() === 'true') {
      try { await markFolderFavorite(cfg) }
      catch (e) { console.warn('[webdav] Favorit-Markierung fehlgeschlagen (Publish bleibt gueltig):', e.message) }
    }
    if (String(process.env.WEBDAV_CREATE_SHARE_LINK).toLowerCase() === 'true') {
      try { result.shareLink = await createShareLink(cfg) }
      catch (e) { console.warn('[webdav] Share-Link-Erstellung fehlgeschlagen (Publish bleibt gueltig):', e.message) }
    }

    return result
  } catch (e) {
    console.error('[webdav] Publish fehlgeschlagen:', e.message)
    return { ok: false, error: e.message }
  }
}

module.exports = { getConfig, testConnection, ensureFolder, putFile, markFolderFavorite, createShareLink, publishDocument, _joinUrl }
