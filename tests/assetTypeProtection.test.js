'use strict'
// Schutzziel-Vererbung vom Asset-Typ (#64, Teil 2).
//
// Ab hier wirken ZWEI Vererbungsquellen auf dieselben vier Werte:
//   1. der Asset-Typ (Vorgabe für alle Assets dieses Typs),
//   2. die Abhängigkeitsvererbung nach BSI-Maximumprinzip (seit #29).
//
// Die Festlegungen, die hier abgesichert werden (siehe Kommentar in #64):
//   • Das Maximum gewinnt — auch gegen einen bewusst niedriger gesetzten Wert.
//   • Der Typwert ist ein dauerhafter Bezug, kein Startwert: Eine Änderung am
//     Typ wirkt sofort auf alle Assets ohne `protectionOverride`.
//   • `protectionOverride` unterscheidet die bewusste Abweichung von einem
//     Wert, der nur zufällig gleich ist.

const protection = require('../server/db/assetProtection')
const assetTypes = require('../server/db/assetTypes')

const TYPES = [
  { id: 'hardware_workstation', label: 'Workstation', category: 'hardware', protection: { c: 2, i: 2, a: 2 } },
  { id: 'data_database',        label: 'Database',    category: 'data',     protection: { c: 4 } },
  { id: 'hardware_other',       label: 'Other',       category: 'hardware' },   // ohne Vorgabe
]

const A = (over) => ({ id: 'a1', name: 'A', classification: 'internal', ...over })

describe('Typvorgabe als Eigenwert', () => {
  test('ein Asset übernimmt die Schutzziele seines Typs', () => {
    const [a] = protection.annotate([A({ type: 'hardware_workstation' })], TYPES)
    expect(a.effectiveProtection.c).toBe(2)
    expect(a.protectionFromType).toBe(true)
    expect(a.protectionSources.c).toBe('type')
    expect(a.protectionTypeId).toBe('hardware_workstation')
  })

  test('der Typ wirkt je Schutzziel — nicht gesetzte Ziele bleiben beim Asset', () => {
    // data_database gibt nur c vor; i/a kommen aus dem Asset.
    const [a] = protection.annotate([A({ type: 'data_database', protection: { c: 1, i: 3, a: 3 } })], TYPES)
    expect(a.effectiveProtection.c).toBe(4)                     // vom Typ
    expect(a.effectiveProtection.i).toBe(3)                     // vom Asset
    expect(a.protectionSources.c).toBe('type')   // c stammt vom Typ
    expect(a.protectionSources.i).toBe('own')   // i vom Asset
    expect(a.protectionOrigins.c).toBe('a1')    // kein anderes Asset hebt an
  })

  test('ein Typ ohne Vorgabe ändert nichts', () => {
    const [a] = protection.annotate([A({ type: 'hardware_other', protection: { c: 3 } })], TYPES)
    expect(a.effectiveProtection.c).toBe(3)
    expect(a.protectionFromType).toBe(false)
    expect(a.protectionSources.c).toBe('own')
  })

  test('ohne Typenliste verhält sich alles wie vor #64', () => {
    const [a] = protection.annotate([A({ type: 'data_database', protection: { c: 3 } })])
    expect(a.effectiveProtection.c).toBe(3)
    expect(a.protectionFromType).toBe(false)
  })
})

describe('protectionOverride bricht die Typvererbung', () => {
  test('der eigene Wert gilt, auch wenn er niedriger ist', () => {
    const [a] = protection.annotate(
      [A({ type: 'data_database', protection: { c: 1 }, protectionOverride: true })], TYPES)
    expect(a.effectiveProtection.c).toBe(1)
    expect(a.protectionSources.c).toBe('own')
    expect(a.protectionFromType).toBe(false)
  })

  test('ohne Override gewinnt der Typ auch über einen niedrigeren Eigenwert', () => {
    const [a] = protection.annotate([A({ type: 'data_database', protection: { c: 1 } })], TYPES)
    expect(a.effectiveProtection.c).toBe(4)
  })

  test('eine Änderung am Typ wirkt sofort — der Bezug ist dauerhaft', () => {
    const asset = A({ type: 'data_database', protection: { c: 1 } })
    const vorher  = protection.annotate([asset], TYPES)[0]
    const geaendert = TYPES.map(t => t.id === 'data_database' ? { ...t, protection: { c: 2 } } : t)
    const nachher = protection.annotate([asset], geaendert)[0]
    expect(vorher.effectiveProtection.c).toBe(4)
    expect(nachher.effectiveProtection.c).toBe(2)   // kein gespeicherter Wert im Weg
  })
})

describe('Zusammenspiel mit der Abhängigkeitsvererbung', () => {
  // Der Fall, den die UI sichtbar machen muss: Workstation ist per Typ auf C=2,
  // aber ein CRM (C=4) hängt von ihr ab. Das Maximum gewinnt.
  const list = () => ([
    { id: 'ws',  name: 'Workstation', type: 'hardware_workstation', classification: 'internal' },
    { id: 'crm', name: 'CRM', type: 'data_database', classification: 'internal',
      protection: { c: 4, i: 2, a: 2 }, dependsOn: ['ws'] },
  ])

  test('die Abhängigkeit hebt den Typwert an', () => {
    const ws = protection.annotate(list(), TYPES).find(a => a.id === 'ws')
    expect(ws.protection.c).toBe(2)                  // Eigenwert aus dem Typ
    expect(ws.effectiveProtection.c).toBe(4)         // angehoben durch das CRM
    expect(ws.protectionOrigins.c).toBe('crm')       // Herkunft nachvollziehbar
  })

  test('das Maximum gewinnt auch gegen einen bewusst gesenkten Wert', () => {
    const l = list()
    l[0] = { ...l[0], protection: { c: 1 }, protectionOverride: true }
    const ws = protection.annotate(l, TYPES).find(a => a.id === 'ws')
    expect(ws.protection.c).toBe(1)                  // Übersteuerung wirkt auf den Eigenwert
    expect(ws.effectiveProtection.c).toBe(4)         // die Abhängigkeit bleibt stärker
    expect(ws.protectionOrigins.c).toBe('crm')       // …und ist als Ursache erkennbar
  })
})

describe('Schutzziele am Typ werden validiert', () => {
  test('gültige Stufen 1–4 werden übernommen', () => {
    const res = assetTypes.validateTypes([{ id: 'x_y', label: 'X', category: 'data', protection: { c: 4, auth: 1 } }])
    expect(res.errors).toEqual([])
    expect(res.types[0].protection).toEqual({ c: 4, auth: 1 })
  })

  test.each([['0', 0], ['5', 5], ['Text', 'hoch'], ['Kommazahl', 2.5]])(
    'ungültige Stufe (%s) wird abgelehnt', (_n, val) => {
      const res = assetTypes.validateTypes([{ id: 'x_y', label: 'X', category: 'data', protection: { c: val } }])
      expect(res.errors.join(' ')).toMatch(/protection/)
    })

  test('ein Typ ohne Schutzziele bekommt kein leeres protection-Feld', () => {
    const res = assetTypes.validateTypes([{ id: 'x_y', label: 'X', category: 'data', protection: {} }])
    expect(res.errors).toEqual([])
    expect(res.types[0].protection).toBeUndefined()
  })
})
