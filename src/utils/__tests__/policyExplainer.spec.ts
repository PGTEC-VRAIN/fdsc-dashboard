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
import { classifyPolicy, explainPolicy, groupPoliciesByService } from '@/utils/policyExplainer'

const odrl = JSON.stringify({
  '@type': 'odrl:Policy',
  'odrl:permission': {
    'odrl:assigner': 'did:web:iiama.example',
    'odrl:action': 'odrl:use',
    'odrl:target': {
      'odrl:refinement': {
        'odrl:leftOperand': 'http:path',
        'odrl:operator': 'http:isInPath',
        'odrl:rightOperand': { '@value': '/tetis-dev', '@type': 'xsd:string' },
      },
    },
  },
})

describe('classifyPolicy', () => {
  it('deduce servicio y variante del UID', () => {
    const r = classifyPolicy({ id: 'a', 'odrl:uid': 'https://x.eu/policy/tetis-dev-access-admin', odrl })
    expect(r.service).toBe('tetis-dev')
    expect(r.entry.variant).toBe('admin')
    expect(r.entry.paths).toEqual(['/tetis-dev'])
  })

  it('separa el pedido del marketplace del UID', () => {
    const r = classifyPolicy({
      id: 'b',
      'odrl:uid': 'https://x.eu/policy/tetis/dashboard-access-user-urn:ngsi-ld:product-order:66e8d493-11ee-4232-b82a-a940c544b345',
    })
    expect(r.service).toBe('tetis-dashboard')
    expect(r.entry.variant).toBe('user')
    expect(r.entry.orderId).toBe('66e8d493-11ee-4232-b82a-a940c544b345')
  })

  it('reconoce la organización a la que se concede el acceso', () => {
    const r = classifyPolicy({ id: 'd', 'odrl:uid': 'https://iiama.x.eu/policy/ciudadania/water4cast-access' }, ['ciudadania'])
    expect(r.service).toBe('water4cast')
    expect(r.entry.grantee).toBe('ciudadania')
    expect(r.entry.owner).toBe('iiama')
  })

  it('una política sin patrón «-access» es su propio servicio', () => {
    expect(classifyPolicy({ id: 'c', 'odrl:uid': 'https://x.eu/policy/otra' }).service).toBe('otra')
  })
})

describe('groupPoliciesByService', () => {
  it('agrupa y ordena por servicio', () => {
    const groups = groupPoliciesByService([
      { id: '1', 'odrl:uid': 'https://x.eu/policy/tetis-dev-access-user' },
      { id: '2', 'odrl:uid': 'https://x.eu/policy/hidris-access' },
      { id: '3', 'odrl:uid': 'https://x.eu/policy/tetis-dev-access-admin' },
    ])
    expect(groups.map((g) => g.key)).toEqual(['hidris', 'tetis-dev'])
    expect(groups[1].entries).toHaveLength(2)
  })
})

describe('explainPolicy', () => {
  it('explica una política ODRL en nodos con clave i18n', () => {
    const blocks = explainPolicy(odrl)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('permission')
    const keys = JSON.stringify(blocks[0].nodes)
    expect(keys).toContain('policy.rule_permission')
    expect(keys).toContain('policy.c_path_isInPath')
  })

  it('devuelve lista vacía con entradas no reconocibles', () => {
    expect(explainPolicy('no-json')).toEqual([])
  })
})
