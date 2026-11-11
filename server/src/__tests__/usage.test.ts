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
import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  createUsageRouter,
  loadUsageConfig,
  identityFromClaims,
  normalizeOrder,
  orderBelongsTo,
  parseAccessLogLine,
  parseNginxTime,
  type UsageConfig,
} from '../usage.js'
import type { Logger } from '../logger.js'

const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger
const passGuard: express.RequestHandler = (_req, _res, next) => next()

const LINE =
  '10.42.0.12 - - [11/Nov/2026:11:30:05 +0000] iiama.example.eu "GET /tetis-dev/api/basins HTTP/1.1" 200 1532 0.012 "-" "Mozilla/5.0" 10.42.1.5:8080 200 0.011 "http://tetis:8080/api/basins"'

const cfg = (over: Partial<UsageConfig> = {}): UsageConfig => ({
  ...loadUsageConfig({}),
  ...over,
})

function app(c: UsageConfig, deps = {}) {
  const a = express()
  a.use(createUsageRouter(c, passGuard, logger, deps))
  return a
}

describe('loadUsageConfig', () => {
  it('no trae nada específico de un proveedor por defecto', () => {
    const c = loadUsageConfig({})
    expect(c.providerDid).toBe('')
    expect(c.tmfApiUrl).toBe('')
    expect(c.logsNamespace).toBe('')
    expect(c.logsSelector).toBe('app.kubernetes.io/name=apisix')
  })

  it('lee las variables de entorno y quita la barra final de la URL', () => {
    const c = loadUsageConfig({ PROVIDER_DID: 'did:web:x.eu', TMF_API_URL: 'http://tmf:8080/' })
    expect(c.providerDid).toBe('did:web:x.eu')
    expect(c.tmfApiUrl).toBe('http://tmf:8080')
  })
})

describe('parseAccessLogLine', () => {
  it('extrae los campos de una línea de acceso de APISIX', () => {
    const e = parseAccessLogLine(LINE)
    expect(e).toMatchObject({
      ip: '10.42.0.12',
      host: 'iiama.example.eu',
      method: 'GET',
      path: '/tetis-dev/api/basins',
      status: 200,
      bytes: 1532,
      seconds: 0.012,
      time: '2026-11-11T11:30:05+00:00',
    })
  })

  it('ignora líneas que no son de acceso, sondas y métricas', () => {
    expect(parseAccessLogLine('2026/11/11 [error] algo')).toBeNull()
    expect(parseAccessLogLine(LINE.replace('Mozilla/5.0', 'kube-probe/1.30'))).toBeNull()
    expect(parseAccessLogLine(LINE.replace('/tetis-dev/api/basins', '/apisix/prometheus/metrics'))).toBeNull()
  })

  it('parseNginxTime rechaza formatos raros', () => {
    expect(parseNginxTime('ayer')).toBeNull()
  })
})

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const CLAIMS = {
  sub: 'did:web:vrain.example.eu',
  verifiableCredential: {
    type: ['VerifiableCredential', 'ServiceCredential'],
    issuer: 'did:web:vrain.example.eu',
    credentialSubject: { username: 'maria', roles: [{ names: ['tetis_admin', 'clearence1'], target: 'x' }, 'viewer'] },
  },
}

describe('identidad en el log de acceso', () => {
  it('extrae usuario, roles, organización y tipo de credencial', () => {
    expect(identityFromClaims(CLAIMS)).toEqual({
      subject: 'did:web:vrain.example.eu',
      username: 'maria',
      roles: ['tetis_admin', 'clearence1', 'viewer'],
      organization: 'did:web:vrain.example.eu',
      credentialTypes: ['ServiceCredential'],
    })
  })

  it('usa el nombre completo o el correo si no hay username', () => {
    const c = { sub: 's', verifiableCredential: { credentialSubject: { firstName: 'Ana', lastName: 'Gil', email: 'a@b.eu' } } }
    expect(identityFromClaims(c)?.username).toBe('Ana Gil')
  })

  it('devuelve null sin datos de identidad', () => {
    expect(identityFromClaims({ iat: 1 })).toBeNull()
    expect(identityFromClaims('x')).toBeNull()
  })

  it('parseAccessLogLine lee el payload añadido al final de la línea', () => {
    const e = parseAccessLogLine(`${LINE} "${b64(CLAIMS)}"`)
    expect(e?.identity?.username).toBe('maria')
    expect(e?.identity?.roles).toContain('tetis_admin')
  })

  it('sin payload la identidad es null', () => {
    expect(parseAccessLogLine(LINE)?.identity).toBeNull()
    expect(parseAccessLogLine(`${LINE} "-"`)?.identity).toBeNull()
  })
})

describe('pedidos', () => {
  const order = {
    id: 'urn:ngsi-ld:product-order:1',
    state: 'completed',
    orderDate: '2026-11-10T10:00:00Z',
    productOrderItem: [{ action: 'add', productOffering: { id: 'o1', name: 'TETIS Dashboard' } }],
    relatedParty: [
      { id: 'p1', name: 'did:web:iiama.pgtec-vrain-dataspace.eu', role: 'Seller' },
      { id: 'p2', name: 'did:web:vrain.pgtec-vrain-dataspace.eu', role: 'Customer' },
    ],
  }

  it('normaliza un productOrder', () => {
    const n = normalizeOrder(order)
    expect(n.state).toBe('completed')
    expect(n.items[0].offeringName).toBe('TETIS Dashboard')
    expect(n.parties).toHaveLength(2)
  })

  it('filtra por el host del DID del proveedor, o no filtra sin DID', () => {
    const n = normalizeOrder(order)
    expect(orderBelongsTo(n, 'did:web:iiama.pgtec-vrain-dataspace.eu')).toBe(true)
    expect(orderBelongsTo(n, 'did:web:avamet.pgtec-vrain-dataspace.eu')).toBe(false)
    expect(orderBelongsTo(n, '')).toBe(true)
  })

  it('GET /api/usage/orders devuelve los pedidos del proveedor', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [order, { ...order, id: 'otro', relatedParty: [{ id: 'z', name: 'did:web:avamet.x.eu' }] }],
    })
    const res = await request(
      app(cfg({ tmfApiUrl: 'http://tmf:8080', providerDid: 'did:web:iiama.pgtec-vrain-dataspace.eu' }), { fetchImpl }),
    ).get('/api/usage/orders')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(fetchImpl.mock.calls[0][0]).toContain('http://tmf:8080/tmf-api/productOrderingManagement/v4/productOrder')
  })

  it('404 si TMF_API_URL no está configurada', async () => {
    const res = await request(app(cfg())).get('/api/usage/orders')
    expect(res.status).toBe(404)
  })

  it('502 si TM Forum falla', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const res = await request(app(cfg({ tmfApiUrl: 'http://tmf' }), { fetchImpl })).get('/api/usage/orders')
    expect(res.status).toBe(502)
  })
})

describe('accesos desde fichero', () => {
  it('lee el log de un fichero cuando ACCESS_LOGS_FILE está definido', async () => {
    const fs = await import('node:fs')
    const os = await import('node:os')
    const path = `${os.tmpdir()}/usage-test-${process.pid}.log`
    fs.writeFileSync(path, `${LINE}\nruido\n`)
    const res = await request(app(cfg({ logsFile: path }))).get('/api/usage/access')
    fs.unlinkSync(path)
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
  })
})

describe('accesos', () => {
  it('devuelve las entradas parseadas, las más recientes primero', async () => {
    const logSource = {
      fetchLogs: vi.fn().mockResolvedValue([
        LINE,
        LINE.replace('11:30:05', '11:45:00'),
        'basura',
      ]),
    }
    const res = await request(app(cfg({ logsNamespace: 'iiama' }), { logSource })).get('/api/usage/access?sinceSeconds=600')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.entries[0].time > res.body.entries[1].time).toBe(true)
    expect(logSource.fetchLogs).toHaveBeenCalledWith(600, 5000)
  })

  it('404 sin namespace configurado', async () => {
    const res = await request(app(cfg())).get('/api/usage/access')
    expect(res.status).toBe(404)
  })

  it('/api/usage/config indica qué está disponible', async () => {
    const res = await request(app(cfg({ tmfApiUrl: 'http://tmf', providerDid: 'did:web:a.eu' }))).get('/api/usage/config')
    expect(res.body).toEqual({ orders: true, accessLogs: false, providerDid: 'did:web:a.eu' })
  })
})
