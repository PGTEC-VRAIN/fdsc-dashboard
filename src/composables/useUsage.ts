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

export const fetchAccess = (sinceSeconds: number, limit = 1000) =>
  getJson<{ total: number; entries: AccessEntry[] }>(
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
