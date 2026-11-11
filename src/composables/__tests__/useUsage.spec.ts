/*
 * Copyright 2026 Seamless Middleware Technologies S.L and/or its affiliates
 * and other contributors as indicated by the @author tags.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { describe, it, expect } from 'vitest'
import { groupByUserMinute, summarizeUsers, whoKey, type AccessEntry } from '@/composables/useUsage'

const id = (name: string) => ({ subject: `did:web:${name}.eu`, username: name, roles: ['a', 'b'], organization: `did:web:${name}.eu`, credentialTypes: [] })

const e = (time: string, path: string, status: number, who: string | null, ip = '10.0.0.1', seconds = 0.1): AccessEntry => ({
  time, ip, host: 'h', method: 'GET', path, status, bytes: 1, seconds, userAgent: 'ua', identity: who ? id(who) : null,
})

const ENTRIES = [
  e('2026-11-11T14:38:50+00:00', '/dashboard/a', 200, 'alex'),
  e('2026-11-11T14:38:53+00:00', '/dashboard/b', 200, 'alex', '10.0.0.1', 0.3),
  e('2026-11-11T14:38:55+00:00', '/hidris/x', 403, 'alex'),
  e('2026-11-11T14:39:05+00:00', '/dashboard/a', 200, 'alex'),
  e('2026-11-11T14:38:56+00:00', '/dashboard/a', 401, null, '10.0.0.9'),
  e('2026-11-11T14:38:57+00:00', '/dashboard/a', 200, 'maria'),
]

describe('whoKey', () => {
  it('distingue personas y agrupa a los anónimos por IP', () => {
    expect(whoKey(ENTRIES[0])).toBe(whoKey(ENTRIES[1]))
    expect(whoKey(ENTRIES[0])).not.toBe(whoKey(ENTRIES[5]))
    expect(whoKey(ENTRIES[4])).toBe('anon:10.0.0.9')
  })
})

describe('groupByUserMinute', () => {
  const groups = groupByUserMinute(ENTRIES)

  it('agrupa por persona y minuto', () => {
    // alex 14:38 (3 peticiones), alex 14:39 (1), anónimo 14:38 (1), maria 14:38 (1)
    expect(groups).toHaveLength(4)
    const g = groups.find((x) => x.who === 'alex' && x.count === 3)!
    expect(g.services).toEqual([{ key: 'dashboard', count: 2 }, { key: 'hidris', count: 1 }])
    expect(g.statusCounts).toEqual({ ok: 2, denied: 1, errors: 0 })
    expect(g.worstStatus).toBe(403)
    expect(g.maxSeconds).toBeCloseTo(0.3)
    expect(g.time).toBe('2026-11-11T14:38:55+00:00')
  })

  it('ordena por momento, lo más reciente primero', () => {
    expect(groups[0].time > groups[groups.length - 1].time).toBe(true)
  })

  it('devuelve lista vacía sin entradas', () => {
    expect(groupByUserMinute([])).toEqual([])
  })
})

describe('summarizeUsers', () => {
  const users = summarizeUsers(ENTRIES)

  it('resume por persona: primera y última vez, número y servicios', () => {
    const alex = users.find((u) => u.name === 'alex')!
    expect(alex.count).toBe(4)
    expect(alex.first).toBe('2026-11-11T14:38:50+00:00')
    expect(alex.last).toBe('2026-11-11T14:39:05+00:00')
    expect(alex.denied).toBe(1)
    expect(alex.services[0]).toEqual({ key: 'dashboard', count: 3 })
  })

  it('incluye a los accesos sin credencial como una fila aparte con su IP', () => {
    const anon = users.find((u) => !u.identity)!
    expect(anon.ips).toEqual(['10.0.0.9'])
    expect(anon.denied).toBe(1)
  })

  it('ordena por último acceso', () => {
    expect(users[0].name).toBe('alex')
  })
})
