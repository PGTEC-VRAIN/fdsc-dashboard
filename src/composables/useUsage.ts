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
/**
 * Acceso al registro de uso del BFF: pedidos del marketplace (TM Forum) y accesos de APISIX.
 *
 * El BFF inyecta `window.__USAGE_CONFIG__` con lo que está disponible en este despliegue.
 * Sin ese global (servidor de desarrollo de Vite) se asume todo disponible.
 */
import { getAuthTokenSync } from '@/composables/useAuth'

export interface UsageFeatures {
  orders: boolean
  accessLogs: boolean
  providerDid: string | null
}

export interface OrderSummary {
  id: string
  state: string
  date: string | null
  items: { offeringId: string; offeringName: string; action: string }[]
  parties: { id: string; name: string; role: string }[]
}

export interface AccessIdentity {
  subject: string | null
  username: string | null
  roles: string[]
  organization: string | null
  credentialTypes: string[]
}

export interface AccessEntry {
  time: string
  ip: string
  host: string
  method: string
  path: string
  status: number
  bytes: number
  seconds: number
  userAgent: string
  identity: AccessIdentity | null
}

export function loadUsageFeatures(): UsageFeatures {
  const raw = (window as unknown as Record<string, unknown>).__USAGE_CONFIG__
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    return {
      orders: o.orders === true,
      accessLogs: o.accessLogs === true,
      providerDid: typeof o.providerDid === 'string' ? o.providerDid : null,
    }
  }
  return { orders: true, accessLogs: true, providerDid: null }
}

async function getJson<T>(url: string): Promise<T> {
  const token = getAuthTokenSync()
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    let msg = `${res.status}`
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg
    } catch {
      /* respuesta sin JSON */
    }
    throw new Error(msg)
  }
  return (await res.json()) as T
}

export const fetchOrders = (limit = 200) =>
  getJson<{ total: number; orders: OrderSummary[] }>(`/api/usage/orders?limit=${limit}`)

export interface AccessDiagnostics {
  sources: number
  lines: number
  parsed: number
  sample: string | null
}

export const fetchAccess = (sinceSeconds: number, limit = 1000) =>
  getJson<{ total: number; entries: AccessEntry[]; diagnostics?: AccessDiagnostics }>(
    `/api/usage/access?sinceSeconds=${sinceSeconds}&limit=${limit}`,
  )

/** Servicio al que pertenece una ruta: su primer segmento (`/tetis-dev/api/x` → `tetis-dev`). */
export function serviceOfPath(path: string): string {
  const seg = path.split('?')[0].split('/').filter(Boolean)[0]
  return seg ?? '/'
}

/** Cuenta elementos por clave, de mayor a menor. */
export function countBy<T>(items: T[], key: (i: T) => string): { key: string; count: number }[] {
  const m = new Map<string, number>()
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1)
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count)
}

/** «did:web:vrain.pgtec-vrain-dataspace.eu» → «VRAIN». Cualquier otro valor se devuelve tal cual. */
export function orgLabel(org: string | null): string {
  if (!org) return ''
  if (!org.startsWith('did:web:')) return org
  const l = org.slice('did:web:'.length).split('.')[0]
  return l.length <= 6 ? l.toUpperCase() : l.charAt(0).toUpperCase() + l.slice(1)
}

/** Texto para identificar a quien hizo la petición. */
export function whoOf(e: AccessEntry): string {
  const i = e.identity
  return i?.username ?? i?.subject ?? ''
}

// ── Agrupaciones del registro de accesos ─────────────────────────────

/** Clave estable de «quién»: la persona si hay credencial; si no, la IP. */
export function whoKey(e: AccessEntry): string {
  return e.identity ? `${e.identity.subject ?? ''}|${e.identity.username ?? ''}` : `anon:${e.ip}`
}

export interface RequestGroup {
  key: string
  /** Momento de la petición más reciente del grupo. */
  time: string
  who: string
  identity: AccessIdentity | null
  ip: string
  count: number
  entries: AccessEntry[]
  services: { key: string; count: number }[]
  /** Peor estado HTTP del grupo (para colorearlo). */
  worstStatus: number
  statusCounts: { ok: number; denied: number; errors: number }
  avgSeconds: number
  maxSeconds: number
}

const statusBucket = (s: number): 'ok' | 'denied' | 'errors' => (s >= 500 ? 'errors' : s >= 400 ? 'denied' : 'ok')

/** Agrupa las peticiones de la misma persona (o IP, sin credencial) dentro del mismo minuto. */
export function groupByUserMinute(entries: AccessEntry[]): RequestGroup[] {
  const map = new Map<string, AccessEntry[]>()
  for (const e of entries) {
    const k = `${whoKey(e)}@${e.time.slice(0, 16)}`
    const list = map.get(k)
    if (list) list.push(e)
    else map.set(k, [e])
  }
  const groups: RequestGroup[] = []
  for (const [key, list] of map) {
    list.sort((a, b) => b.time.localeCompare(a.time))
    const counts = { ok: 0, denied: 0, errors: 0 }
    for (const e of list) counts[statusBucket(e.status)]++
    groups.push({
      key,
      time: list[0].time,
      who: whoOf(list[0]),
      identity: list[0].identity,
      ip: list[0].ip,
      count: list.length,
      entries: list,
      services: countBy(list, (e) => serviceOfPath(e.path)).map((s) => ({ key: s.key, count: s.count })),
      worstStatus: Math.max(...list.map((e) => e.status)),
      statusCounts: counts,
      avgSeconds: list.reduce((a, e) => a + e.seconds, 0) / list.length,
      maxSeconds: Math.max(...list.map((e) => e.seconds)),
    })
  }
  return groups.sort((a, b) => b.time.localeCompare(a.time))
}

export interface UserSummary {
  key: string
  name: string
  identity: AccessIdentity | null
  ips: string[]
  first: string
  last: string
  count: number
  denied: number
  errors: number
  services: { key: string; count: number }[]
}

/** Resumen por persona: cuándo entró por primera y última vez, cuántas veces y a qué servicios. */
export function summarizeUsers(entries: AccessEntry[]): UserSummary[] {
  const map = new Map<string, AccessEntry[]>()
  for (const e of entries) {
    const k = whoKey(e)
    const list = map.get(k)
    if (list) list.push(e)
    else map.set(k, [e])
  }
  const out: UserSummary[] = []
  for (const [key, list] of map) {
    const times = list.map((e) => e.time).sort()
    out.push({
      key,
      name: whoOf(list[0]),
      identity: list[0].identity,
      ips: [...new Set(list.map((e) => e.ip))],
      first: times[0],
      last: times[times.length - 1],
      count: list.length,
      denied: list.filter((e) => e.status >= 400 && e.status < 500).length,
      errors: list.filter((e) => e.status >= 500).length,
      services: countBy(list, (e) => serviceOfPath(e.path)).map((s) => ({ key: s.key, count: s.count })),
    })
  }
  return out.sort((a, b) => b.last.localeCompare(a.last))
}
