// © 2026 Claude Hecker — ISMS Builder — AGPL-3.0
//
// Lieferanten-Schnelltriage entlang drei Achsen — PII, ISO 27001, SOC 2 — damit
// ein kleines ISMS-Team auf einen Blick sieht, welche Lieferanten eine volle
// Bewertung brauchen. Spezifiziert in Issue #63 (Vorschlag von @jasc76,
// Scoring-Regeln finalisiert im zweiten Issue-Kommentar).
//
// Backend-neutral wie assetProtection.js: der berechnete Wert wird nie
// gespeichert, sondern bei jedem Lesen aus den drei Rohantworten neu
// abgeleitet — ein geänderter Input wirkt sofort, kein veralteter Wert kann
// persistieren.
'use strict'

const LEVELS = ['low', 'medium', 'high']
const LEVEL_RANK = { low: 1, medium: 2, high: 3 }

const AXIS_ENUMS = {
  pii:      ['none', 'personal', 'special'],
  soc2:     ['in_place', 'na', 'partial', 'not_available'],
  iso27001: ['in_place', 'partial', 'none'],
}

/**
 * PII-Achse: 'none' | 'personal' | 'special' → low / medium / high.
 * Fehlt der Wert, ist die Achse unassessed.
 */
function _piiLevel(pii) {
  const v = pii && pii.processes
  if (v === undefined || v === null || v === '') return null
  switch (v) {
    case 'none':     return 'low'
    case 'personal': return 'medium'
    case 'special':  return 'high'
    default:         return null
  }
}

/**
 * SOC2-Achse: 'in_place' | 'na' | 'partial' | 'not_available' → low/medium/high.
 * 'na' zaehlt bewusst als low, nicht als unassessed — ein nicht anwendbarer
 * SOC2-Bericht ist kein Mangel.
 */
function _soc2Level(soc2) {
  const v = soc2 && soc2.status
  if (v === undefined || v === null || v === '') return null
  switch (v) {
    case 'in_place':     return 'low'
    case 'na':            return 'low'
    case 'partial':       return 'medium'
    case 'not_available': return 'high'
    default:               return null
  }
}

/** ISO27001-Achse: 'in_place' | 'partial' | 'none' → low/medium/high. */
function _iso27001Level(iso27001) {
  const v = iso27001 && iso27001.status
  if (v === undefined || v === null || v === '') return null
  switch (v) {
    case 'in_place': return 'low'
    case 'partial':  return 'medium'
    case 'none':      return 'high'
    default:          return null
  }
}

/**
 * Berechnet triageResult aus dem gespeicherten triage-Objekt.
 * Maximum-Prinzip ueber alle drei Achsen; fehlt eine Achse komplett (kein
 * triage-Objekt oder keine der drei Achsen beantwortet), ist das Ergebnis
 * 'unassessed' — Abwesenheit von Information ist kein gutes Ergebnis.
 * @param {object|null|undefined} triage
 * @returns {{level: 'low'|'medium'|'high'|'unassessed', axes: {pii: string|null, soc2: string|null, iso27001: string|null}}}
 */
function computeTriageResult(triage) {
  const axes = {
    pii:      _piiLevel(triage && triage.pii),
    soc2:     _soc2Level(triage && triage.soc2),
    iso27001: _iso27001Level(triage && triage.iso27001),
  }

  const answered = Object.values(axes).filter(Boolean)
  if (!answered.length) return { level: 'unassessed', axes }

  const level = answered.reduce((worst, cur) =>
    LEVEL_RANK[cur] > LEVEL_RANK[worst] ? cur : worst
  , 'low')

  return { level, axes }
}

/**
 * Prueft ein rohes triage-Objekt gegen die erlaubten Enum-Werte je Achse.
 * Ein leerer/undefinierter Wert ist gueltig (Achse noch nicht beantwortet) —
 * nur ein tatsaechlich gesetzter, unbekannter Wert ist ein Fehler.
 * @returns {string[]} Fehlermeldungen; leeres Array = gueltig.
 */
function validateTriage(input) {
  if (input === undefined || input === null) return []
  if (typeof input !== 'object') return ['triage muss ein Objekt sein']

  const errors = []
  for (const [axis, allowed] of Object.entries(AXIS_ENUMS)) {
    const field = axis === 'pii' ? 'processes' : 'status'
    const value = input[axis]?.[field]
    if (value !== undefined && value !== '' && !allowed.includes(value)) {
      errors.push(`triage.${axis}.${field}: unbekannter Wert '${value}' (erlaubt: ${allowed.join(', ')})`)
    }
  }
  return errors
}

/** Baut ein vollstaendiges, normalisiertes triage-Objekt aus bereits validiertem Rohinput. */
function normalizeTriage(input) {
  const src = input && typeof input === 'object' ? input : {}
  return {
    pii:      { processes: _oneOf(src.pii?.processes, AXIS_ENUMS.pii) },
    soc2:     { status: _oneOf(src.soc2?.status, AXIS_ENUMS.soc2) },
    iso27001: { status: _oneOf(src.iso27001?.status, AXIS_ENUMS.iso27001) },
    assessedAt: typeof src.assessedAt === 'string' ? src.assessedAt : '',
    assessedBy: typeof src.assessedBy === 'string' ? src.assessedBy : '',
    notes:      typeof src.notes === 'string' ? src.notes : '',
  }
}

function _oneOf(value, allowed) {
  return allowed.includes(value) ? value : ''
}

module.exports = { LEVELS, AXIS_ENUMS, computeTriageResult, validateTriage, normalizeTriage }
