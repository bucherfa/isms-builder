// © 2026 Claude Hecker — ISMS Builder — AGPL-3.0
//
// Update-Check: fragt bei Bedarf (Admin klickt aktiv, kein Hintergrund-Cron)
// den neuesten GitHub-Release ab und vergleicht ihn mit der laufenden Version.
// Zeigt nur einen Hinweis an — laedt und wendet nichts automatisch an. Ein
// automatisches Nachziehen von Code auf ein selbstgehostetes System waere ein
// erhebliches Sicherheitsrisiko (Supply-Chain: ein kompromittierter Release
// koennte sich sonst automatisch auf jede Installation verteilen) und passt
// nicht zum Betriebsmodell des Projekts ("Betrieb liegt beim Betreiber").
'use strict'

const REPO = 'coolstartnow/isms-builder'
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const CACHE_TTL_MS = 60 * 60 * 1000 // 1h — schont GitHubs unauthentifiziertes Rate-Limit

let _cache = null // { at, result }

/** Vergleicht zwei punktgetrennte Versionsnummern (nicht strikt semver, das Projekt nutzt auch 4-Teiler wie 1.37.5.1). */
function _isNewer(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const pb = String(b).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na !== nb) return na > nb
  }
  return false
}

/**
 * @param {boolean} force Cache ignorieren und neu abfragen.
 * @returns {Promise<{ok:boolean, currentVersion:string, latestVersion?:string, updateAvailable?:boolean, releaseUrl?:string, checkedAt?:string, error?:string}>}
 */
async function checkForUpdate(force = false) {
  const currentVersion = require('../package.json').version

  if (!force && _cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return _cache.result
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(RELEASES_URL, {
      headers: { 'User-Agent': 'isms-builder-update-check', Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })

    if (!res.ok) {
      const result = { ok: false, currentVersion, error: `GitHub-API antwortete mit ${res.status}` }
      _cache = { at: Date.now(), result }
      return result
    }

    const data = await res.json()
    const latestVersion = String(data.tag_name || '').replace(/^v/i, '')
    const result = {
      ok: true,
      currentVersion,
      latestVersion,
      updateAvailable: latestVersion ? _isNewer(latestVersion, currentVersion) : false,
      releaseUrl: data.html_url || `https://github.com/${REPO}/releases`,
      checkedAt: new Date().toISOString(),
    }
    _cache = { at: Date.now(), result }
    return result
  } catch (e) {
    const result = { ok: false, currentVersion, error: e.name === 'AbortError' ? 'Zeitüberschreitung bei der Anfrage an GitHub' : e.message }
    _cache = { at: Date.now(), result }
    return result
  } finally {
    clearTimeout(timeout)
  }
}

module.exports = { checkForUpdate }
