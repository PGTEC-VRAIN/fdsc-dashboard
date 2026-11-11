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
 * Registro de uso del conector: pedidos del marketplace (TM Forum) y accesos
 * a los servicios (log de acceso de APISIX).
 *
 * Todo se configura por variables de entorno, sin nada específico de un proveedor,
 * de modo que la misma imagen sirve para cualquier conector:
 *
 * - `PROVIDER_DID`       DID del proveedor (`did:web:<host>`). Filtra los pedidos y se
 *                        expone al navegador. Vacío = sin filtro.
 * - `TMF_API_URL`        URL base de la API TM Forum (p. ej. `http://tm-forum-api-svc:8080`).
 *                        Vacío = pestaña de pedidos desactivada.
 * - `TMF_ORDER_PATH`     Ruta de productOrder (por defecto TMF622 v4).
 * - `ACCESS_LOGS_NAMESPACE` Namespace de los pods de APISIX. Vacío = pestaña de accesos
 *                        desactivada. Requiere permiso `get/list` de pods y `get` de `pods/log`.
 * - `ACCESS_LOGS_FILE`  Alternativa sin Kubernetes: fichero con el log de acceso de APISIX
 *                        (p. ej. montado en Docker Compose). Tiene prioridad sobre el namespace.
 * - `ACCESS_LOGS_SELECTOR`  Selector de etiquetas (por defecto `app.kubernetes.io/name=apisix`).
 * - `ACCESS_LOGS_CONTAINER` Contenedor del que leer (por defecto `apisix`).
 */

import fs from 'node:fs'
import https from 'node:https'
import { Router, type RequestHandler } from 'express'
import type { Logger } from './logger.js'

export interface UsageConfig {
  providerDid: string
  tmfApiUrl: string
  tmfOrderPath: string
  logsNamespace: string
  logsFile: string
  logsSelector: string
  logsContainer: string
}

export function loadUsageConfig(env: Record<string, string | undefined> = process.env): UsageConfig {
  return {
    providerDid: env.PROVIDER_DID || '',
    tmfApiUrl: (env.TMF_API_URL || '').replace(/\/+$/, ''),
    tmfOrderPath: env.TMF_ORDER_PATH || '/tmf-api/productOrderingManagement/v4/productOrder',
    logsNamespace: env.ACCESS_LOGS_NAMESPACE || '',
    logsFile: env.ACCESS_LOGS_FILE || '',
    logsSelector: env.ACCESS_LOGS_SELECTOR || 'app.kubernetes.io/name=apisix',
    logsContainer: env.ACCESS_LOGS_CONTAINER || 'apisix',
  }
}

export interface UsageFeatures {
  orders: boolean
  accessLogs: boolean
  providerDid: string | null
}

export function getUsageFeatures(c: UsageConfig): UsageFeatures {
  return {
    orders: c.tmfApiUrl !== '',
    accessLogs: c.logsNamespace !== '' || c.logsFile !== '',
    providerDid: c.providerDid || null,
  }
}

// ── Pedidos (TM Forum) ────────────────────────────────────────────────

export interface OrderParty {
  id: string
  name: string
  role: string
}

export interface OrderSummary {
  id: string
  state: string
  date: string | null
  items: { offeringId: string; offeringName: string; action: string }[]
  parties: OrderParty[]
}

type Json = Record<string, unknown>
const asArr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : v ? [v as Json] : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** Convierte un productOrder de TM Forum en un resumen plano. */
export function normalizeOrder(o: Json): OrderSummary {
  return {
    id: str(o.id),
    state: str(o.state) || 'unknown',
    date: str(o.orderDate || o.creationDate || o.requestedStartDate) || null,
    items: asArr(o.productOrderItem).map((it) => {
      const po = (it.productOffering ?? {}) as Json
      return { offeringId: str(po.id), offeringName: str(po.name), action: str(it.action) }
    }),
    parties: asArr(o.relatedParty).map((p) => ({
      id: str(p.id),
      name: str(p.name),
      role: str(p.role),
    })),
  }
}

/**
 * ¿El pedido pertenece al proveedor? Heurística: el host del DID del proveedor aparece
 * en alguna parte relacionada (en el marketplace el nombre de la organización es su DID).
 * Sin DID de proveedor no se filtra.
 */
export function orderBelongsTo(order: OrderSummary, providerDid: string): boolean {
  if (!providerDid) return true
  const host = providerDid.replace(/^did:web:/, '').toLowerCase()
  return order.parties.some((p) => `${p.id} ${p.name}`.toLowerCase().includes(host))
}

// ── Accesos (log de acceso de APISIX) ─────────────────────────────────

/** Quién hizo la petición, según el payload del JWT (sin firma) que APISIX deja en el log. */
export interface AccessIdentity {
  subject: string | null
  username: string | null
  roles: string[]
  /** Organización de la persona: la que emitió su credencial, o la que declara. */
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
  /** null si la petición no llevaba token o el log no incluye el payload. */
  identity: AccessIdentity | null
}

const ACCESS_RE =
  /^(\S+) - (\S+) \[([^\]]+)\] (\S+) "(\S+) (\S+) HTTP\/[\d.]+" (\d{3}) (\d+) ([\d.]+) "([^"]*)" "([^"]*)"/

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

/** `11/Nov/2026:11:00:00 +0000` → ISO-8601. */
export function parseNginxTime(s: string): string | null {
  const m = s.match(/^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/)
  if (!m || !MONTHS[m[2]]) return null
  return `${m[3]}-${MONTHS[m[2]]}-${m[1]}T${m[4]}${m[5]}:${m[6]}`
}

const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/** Nombres de rol de una lista que puede ser de cadenas o de objetos `{names: [...]}`. */
function rolesOf(v: unknown): string[] {
  const out: string[] = []
  for (const r of Array.isArray(v) ? v : v ? [v] : []) {
    if (typeof r === 'string') out.push(r)
    else if (isObj(r)) {
      for (const n of Array.isArray(r.names) ? r.names : [r.name ?? r.role]) if (typeof n === 'string') out.push(n)
    }
  }
  return out
}

/**
 * Extrae la identidad de los claims de un JWT del verifier. Es tolerante: cada dato se busca
 * en el credentialSubject de la credencial y, si no está, en los claims del propio token.
 */
export function identityFromClaims(claims: unknown): AccessIdentity | null {
  if (!isObj(claims)) return null
  const vcRaw = claims.verifiableCredential ?? claims.vc
  const vc = (Array.isArray(vcRaw) ? vcRaw[0] : vcRaw) as unknown
  const v: Json = isObj(vc) ? vc : {}
  const cs: Json = isObj(v.credentialSubject) ? v.credentialSubject : isObj(claims.credentialSubject) ? claims.credentialSubject : {}
  const issuer = isObj(v.issuer) ? asStr(v.issuer.id) : asStr(v.issuer)
  const orgField = isObj(cs.organization) ? asStr(cs.organization.name ?? cs.organization.id) : asStr(cs.organization)
  const fullName = [asStr(cs.firstName), asStr(cs.lastName)].filter(Boolean).join(' ') || null
  const types = (Array.isArray(v.type) ? v.type : [v.type]).filter(
    (t): t is string => typeof t === 'string' && t !== 'VerifiableCredential',
  )
  const identity: AccessIdentity = {
    subject: asStr(claims.sub),
    username:
      asStr(cs.username) ?? asStr(cs.preferred_username) ?? asStr(claims.preferred_username) ??
      fullName ?? asStr(cs.email) ?? asStr(claims.email) ?? asStr(cs.name) ?? asStr(claims.name),
    roles: [...new Set([...rolesOf(cs.roles), ...rolesOf(claims.roles), ...rolesOf((claims.realm_access as Json | undefined)?.roles)])],
    organization: orgField ?? asStr(cs.organizationId) ?? issuer,
    credentialTypes: types,
  }
  return identity.subject || identity.username || identity.roles.length || identity.organization ? identity : null
}

/** Decodifica el payload (segmento central de un JWT, base64url) que APISIX añade al final de la línea. */
export function decodeJwtPayloadSegment(seg: string): unknown {
  try {
    return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/** Devuelve la entrada de acceso, o null si la línea no es de acceso o es ruido interno. */
export function parseAccessLogLine(line: string): AccessEntry | null {
  const m = line.match(ACCESS_RE)
  if (!m) return null
  const time = parseNginxTime(m[3])
  if (!time) return null
  const path = m[6]
  const userAgent = m[11]
  if (path.startsWith('/apisix/') || /kube-probe|Prometheus/i.test(userAgent)) return null
  return {
    time,
    ip: m[1],
    host: m[4],
    method: m[5],
    path,
    status: Number(m[7]),
    bytes: Number(m[8]),
    seconds: Number(m[9]),
    userAgent,
    identity: identityOfLine(line.slice(m[0].length)),
  }
}

/** Última cadena entrecomillada de la línea, si parece el payload de un JWT. */
function identityOfLine(rest: string): AccessIdentity | null {
  const t = rest.match(/"([A-Za-z0-9_-]{16,})"\s*$/)
  return t ? identityFromClaims(decodeJwtPayloadSegment(t[1])) : null
}

// ── Cliente mínimo de la API de Kubernetes (dentro del clúster) ───────

const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount'

export interface LogSource {
  fetchLogs(sinceSeconds: number, tailLines: number): Promise<string[]>
}

function k8sGet(path: string): Promise<string> {
  const host = process.env.KUBERNETES_SERVICE_HOST
  const port = process.env.KUBERNETES_SERVICE_PORT || '443'
  if (!host) return Promise.reject(new Error('No se ejecuta dentro de Kubernetes'))
  const token = fs.readFileSync(`${SA_DIR}/token`, 'utf8').trim()
  const ca = fs.readFileSync(`${SA_DIR}/ca.crt`)
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, port, path, method: 'GET', ca, headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () =>
          res.statusCode && res.statusCode < 300
            ? resolve(body)
            : reject(new Error(`Kubernetes API ${res.statusCode}: ${body.slice(0, 200)}`)),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
}

export function createFileLogSource(path: string): LogSource {
  return {
    async fetchLogs(_sinceSeconds, tailLines) {
      const lines = (await fs.promises.readFile(path, 'utf8')).split('\n')
      return lines.slice(-tailLines)
    },
  }
}

export function createK8sLogSource(c: UsageConfig): LogSource {
  return {
    async fetchLogs(sinceSeconds, tailLines) {
      const ns = encodeURIComponent(c.logsNamespace)
      const pods = JSON.parse(
        await k8sGet(`/api/v1/namespaces/${ns}/pods?labelSelector=${encodeURIComponent(c.logsSelector)}`),
      ) as { items?: { metadata?: { name?: string } }[] }
      const lines: string[] = []
      for (const p of pods.items ?? []) {
        const name = p.metadata?.name
        if (!name) continue
        const q = `container=${encodeURIComponent(c.logsContainer)}&sinceSeconds=${sinceSeconds}&tailLines=${tailLines}`
        const log = await k8sGet(`/api/v1/namespaces/${ns}/pods/${encodeURIComponent(name)}/log?${q}`)
        lines.push(...log.split('\n'))
      }
      return lines
    },
  }
}

// ── Router ────────────────────────────────────────────────────────────

const clamp = (v: unknown, def: number, min: number, max: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def
}

export interface UsageDeps {
  fetchImpl?: typeof fetch
  logSource?: LogSource
}

export function createUsageRouter(
  c: UsageConfig,
  guard: RequestHandler,
  logger: Logger,
  deps: UsageDeps = {},
): Router {
  const router = Router()
  const doFetch = deps.fetchImpl ?? fetch
  const features = getUsageFeatures(c)

  router.get('/api/usage/config', (_req, res) => {
    res.json(features)
  })

  router.get('/api/usage/orders', guard, async (req, res) => {
    if (!features.orders) return res.status(404).json({ error: 'Pedidos no configurados (TMF_API_URL)' })
    const limit = clamp(req.query.limit, 100, 1, 500)
    try {
      const r = await doFetch(`${c.tmfApiUrl}${c.tmfOrderPath}?limit=${limit}`, {
        headers: { accept: 'application/json' },
      })
      if (!r.ok) return res.status(502).json({ error: `TM Forum respondió ${r.status}` })
      const body = (await r.json()) as unknown
      const orders = asArr(body)
        .map(normalizeOrder)
        .filter((o) => orderBelongsTo(o, c.providerDid))
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
      res.json({ total: orders.length, orders })
    } catch (e) {
      logger.error(`usage/orders: ${String(e)}`)
      res.status(502).json({ error: 'No se pudo leer TM Forum' })
    }
  })

  router.get('/api/usage/access', guard, async (req, res) => {
    if (!features.accessLogs) {
      return res.status(404).json({ error: 'Accesos no configurados (ACCESS_LOGS_NAMESPACE o ACCESS_LOGS_FILE)' })
    }
    const sinceSeconds = clamp(req.query.sinceSeconds, 3600, 60, 7 * 86400)
    const limit = clamp(req.query.limit, 500, 1, 5000)
    try {
      const source = deps.logSource ?? (c.logsFile ? createFileLogSource(c.logsFile) : createK8sLogSource(c))
      const lines = await source.fetchLogs(sinceSeconds, 5000)
      const entries = lines
        .map(parseAccessLogLine)
        .filter((e): e is AccessEntry => e !== null)
        .sort((a, b) => b.time.localeCompare(a.time))
      res.json({ total: entries.length, entries: entries.slice(0, limit) })
    } catch (e) {
      logger.error(`usage/access: ${String(e)}`)
      res.status(502).json({ error: 'No se pudieron leer los logs de APISIX' })
    }
  })

  return router
}
