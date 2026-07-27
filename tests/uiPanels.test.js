/**
 * Statische Prüfung von ui/app.js
 *
 * Hintergrund: renderSectionContent() ruft removeAllDynamicPanels() auf, das die
 * dynamischen Panels über eine hartcodierte ID-Liste abräumt. Jede render*-Funktion
 * entfernt nur ihren eigenen Container. Fehlt eine ID in dieser Liste, bleibt das
 * Panel beim Sektionswechsel im DOM stehen — der Nutzer klickt links auf ein anderes
 * Modul und sieht rechts weiterhin das alte (so passiert mit 'nis2Container', V 1.37.0).
 *
 * Der Test ist absichtlich rein textuell: app.js ist eine Browser-Datei ohne Export
 * und lässt sich in Jest nicht ohne DOM laden.
 */
const fs = require('fs')
const path = require('path')

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8')

function removeListIds() {
  const fn = APP_JS.match(/function removeAllDynamicPanels\s*\(\)\s*\{([\s\S]*?)\n\}/)
  expect(fn).not.toBeNull()
  return new Set([...fn[1].matchAll(/'([A-Za-z0-9_]+Container)'/g)].map(m => m[1]))
}

function createdIds() {
  return new Set([...APP_JS.matchAll(/container\.id\s*=\s*'([A-Za-z0-9_]+Container)'/g)].map(m => m[1]))
}

describe('removeAllDynamicPanels', () => {
  test('existiert und listet Container-IDs', () => {
    const ids = removeListIds()
    expect(ids.size).toBeGreaterThan(10)
  })

  test('räumt jeden dynamisch erzeugten Panel-Container ab', () => {
    const listed = removeListIds()
    const missing = [...createdIds()].filter(id => !listed.has(id))
    expect(missing).toEqual([])
  })

  test('nis2Container ist enthalten (Regression V 1.37.0)', () => {
    expect(removeListIds().has('nis2Container')).toBe(true)
  })
})
