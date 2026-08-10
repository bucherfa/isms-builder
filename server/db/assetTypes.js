// © 2026 Claude Hecker — ISMS Builder — AGPL-3.0
//
// Asset-Kategorien und Asset-Typen — die EINZIGE Deklaration im Projekt.
//
// Vorher stand die Typenliste dreimal: in server/db/assetStore.js (JSON),
// in server/db/stores/assetStore.js (Knex) und als ASSET_TYPES_MAP in
// ui/app.js. Die drei Kopien waren bereits auseinandergelaufen — Backend
// deutsch ("Mobilgerät"), Frontend englisch ("Mobile Device") —, und keine
// der beiden Backend-Kopien wurde überhaupt konsumiert.
//
// Backend-neutral: wird von JSON- und Knex-Store genutzt, genau wie
// assetProtection.js. Das UI holt die Liste über die API und hält keine
// eigene Kopie mehr; das ist auch nötig, weil Typen seit #64 editierbar sind.
'use strict'

// Kategorien sind fest: Sie strukturieren die Asset-Übersicht und werden vom
// Typ mitgeführt. Neue Typen ordnen sich einer bestehenden Kategorie zu.
const CATEGORIES = {
  hardware: 'Hardware',
  software: 'Software',
  data:     'Data / Information',
  service:  'Services',
  facility: 'Facilities',
}

const CATEGORY_IDS = Object.keys(CATEGORIES)

// Labels englisch — wie die übrigen editierbaren Listen in customListsStore
// (Technical, Organizational, Customers …) und wie das, was Nutzer bisher im
// UI gesehen haben. Die Typ-IDs bleiben unverändert, damit bestehende Assets
// gültig bleiben.
const DEFAULT_ASSET_TYPES = [
  { id: 'hardware_server',      label: 'Server',                      category: 'hardware' },
  { id: 'hardware_workstation', label: 'Workstation / PC',            category: 'hardware' },
  { id: 'hardware_laptop',      label: 'Laptop / Notebook',           category: 'hardware' },
  { id: 'hardware_mobile',      label: 'Mobile Device',               category: 'hardware' },
  { id: 'hardware_network',     label: 'Network Equipment',           category: 'hardware' },
  { id: 'hardware_ics_ot',      label: 'ICS/OT System',               category: 'hardware' },
  { id: 'hardware_building',    label: 'Building Technology (BAS)',   category: 'hardware' },
  { id: 'hardware_other',       label: 'Hardware (Other)',            category: 'hardware' },
  { id: 'software_app',         label: 'Application Software',        category: 'software' },
  { id: 'software_os',          label: 'Operating System',            category: 'software' },
  { id: 'software_cloud',       label: 'Cloud Service (IaaS/PaaS)',   category: 'software' },
  { id: 'software_saas',        label: 'SaaS Application',            category: 'software' },
  { id: 'software_other',       label: 'Software (Other)',            category: 'software' },
  { id: 'data_database',        label: 'Database',                    category: 'data' },
  { id: 'data_document',        label: 'Document Collection',         category: 'data' },
  { id: 'data_backup',          label: 'Backup / Archive',            category: 'data' },
  { id: 'data_other',           label: 'Data (Other)',                category: 'data' },
  { id: 'service_internal',     label: 'Internal Service',            category: 'service' },
  { id: 'service_cloud',        label: 'Cloud Service (External)',    category: 'service' },
  { id: 'service_external',     label: 'External Service Provider',   category: 'service' },
  { id: 'facility_office',      label: 'Office Building',             category: 'facility' },
  { id: 'facility_datacenter',  label: 'Data Centre / Server Room',   category: 'facility' },
  { id: 'facility_production',  label: 'Production Site / Plant',     category: 'facility' },
  { id: 'facility_other',       label: 'Facility (Other)',            category: 'facility' },
]

const ID_PATTERN = /^[a-z0-9][a-z0-9_]{0,63}$/

// Muss zu assetProtection.PROTECTION_GOALS passen. Bewusst hier dupliziert:
// assetTypes darf nicht von assetProtection abhaengen, sonst entsteht ein
// Ringschluss ueber customListsStore.
const PROTECTION_GOALS = ['c', 'i', 'a', 'auth']

/**
 * Prüft und säubert eine vom Admin gelieferte Typenliste.
 * Gibt { types, errors } zurück — bei nicht-leerem errors darf nicht
 * gespeichert werden. Bewusst streng: Eine kaputte Typenliste macht das
 * Asset-Modul unbenutzbar, und der Fehler fiele erst später auf.
 */
function validateTypes(input) {
  const errors = []
  if (!Array.isArray(input)) return { types: [], errors: ['assetTypes must be an array'] }
  if (input.length === 0)    return { types: [], errors: ['assetTypes must not be empty'] }

  const seen  = new Set()
  const types = []

  input.forEach((raw, i) => {
    const at = raw && typeof raw === 'object' ? raw : {}
    const id       = String(at.id       || '').trim()
    const label    = String(at.label    || '').trim()
    const category = String(at.category || '').trim()

    if (!ID_PATTERN.test(id)) {
      errors.push(`entry ${i + 1}: invalid id "${id}" (lowercase letters, digits and underscore only)`)
      return
    }
    if (seen.has(id)) { errors.push(`entry ${i + 1}: duplicate id "${id}"`); return }
    if (!label)       { errors.push(`entry ${i + 1}: label must not be empty`); return }
    if (!CATEGORY_IDS.includes(category)) {
      errors.push(`entry ${i + 1}: unknown category "${category}" (allowed: ${CATEGORY_IDS.join(', ')})`)
      return
    }

    // Schutzziele am Typ (#64, Teil 2) — optional, je Ziel einzeln setzbar.
    // Ein nicht gesetztes Ziel bedeutet: der Typ macht dazu keine Vorgabe.
    const prot = {}
    const rawProt = at.protection && typeof at.protection === 'object' ? at.protection : {}
    let protInvalid = null
    for (const goal of PROTECTION_GOALS) {
      const v = rawProt[goal]
      if (v === undefined || v === null || v === '') continue
      const n = Number(v)
      if (!Number.isInteger(n) || n < 1 || n > 4) { protInvalid = `${goal}="${v}"`; break }
      prot[goal] = n
    }
    if (protInvalid) {
      errors.push(`entry ${i + 1}: protection ${protInvalid} — expected an integer 1–4`)
      return
    }

    seen.add(id)
    const entry = { id, label, category }
    if (Object.keys(prot).length) entry.protection = prot
    types.push(entry)
  })

  return { types, errors }
}

/** Liefert eine tiefe Kopie der Vorgabe — nie die Konstante selbst. */
function defaults() {
  return DEFAULT_ASSET_TYPES.map(t => ({ ...t }))
}

/** Nachschlagetabelle id → Typ, für Validierung und Label-Auflösung. */
function byId(types) {
  const map = {}
  for (const t of (Array.isArray(types) ? types : defaults())) map[t.id] = t
  return map
}

module.exports = {
  CATEGORIES,
  CATEGORY_IDS,
  DEFAULT_ASSET_TYPES,
  defaults,
  validateTypes,
  byId,
  ID_PATTERN,
  PROTECTION_GOALS,
}
