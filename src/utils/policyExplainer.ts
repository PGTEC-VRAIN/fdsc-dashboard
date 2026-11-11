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
/* eslint-disable @typescript-eslint/no-explicit-any -- el explicador recorre JSON-LD arbitrario */
/**
 * Convierte una política ODRL (JSON-LD del PAP) o una política de credenciales
 * ({claims, credentialsType}) en un árbol de frases traducibles.
 * No depende de Angular: cada nodo lleva una clave i18n y sus parámetros.
 */
export interface PolicyNode {
  key: string;
  params?: Record<string, any>;
  children?: PolicyNode[];
}

export interface PolicyBlock {
  /** 'permission' | 'prohibition' | 'obligation' | 'credentials' | 'unknown' */
  kind: string;
  nodes: PolicyNode[];
}

const P = 'policy.';

const local = (v: any): string => {
  const s = String(v ?? '');
  const i = Math.max(s.lastIndexOf(':'), s.lastIndexOf('#'), s.lastIndexOf('/'));
  return i >= 0 ? s.slice(i + 1) : s;
};

const asArray = (v: any): any[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

const valueOf = (v: any): any => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('@value' in v) return v['@value'];
    if ('@id' in v) return v['@id'];
  }
  return v;
};

const list = (v: any): string => asArray(v).map(valueOf).map(x => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');

/** Pares (operando, operador) que sabemos redactar; el resto se muestra en forma genérica. */
const KNOWN = new Set([
  'role_hasPart', 'role_eq', 'role_isAnyOf',
  'type_hasPart', 'type_eq',
  'currentParty_eq', 'currentParty_isAnyOf',
  'path_isInPath', 'path_eq',
  'entityType_eq', 'entityType_isAnyOf'
]);

const LOGICAL: Record<string, string> = { and: 'all_of', or: 'any_of', xone: 'one_of', andSequence: 'all_of', not: 'none_of' };

function constraintNode(c: any): PolicyNode {
  // Restricción lógica (and / or / xone)
  for (const op of Object.keys(LOGICAL)) {
    const members = c['odrl:' + op] ?? c[op];
    if (members !== undefined) {
      const key = P + LOGICAL[op];
      // Aplana grupos anidados del mismo tipo (todas → todas) y desenvuelve los de un solo elemento
      const kids: PolicyNode[] = [];
      for (const k of asArray(members).map(constraintNode)) {
        if (k.key === key && k.children && op !== 'not') kids.push(...k.children);
        else kids.push(k);
      }
      return kids.length === 1 && op !== 'not' ? kids[0] : { key, children: kids };
    }
  }
  const left = local(valueOf(c['odrl:leftOperand'] ?? c['leftOperand']));
  const oper = local(valueOf(c['odrl:operator'] ?? c['operator']));
  const right = c['odrl:rightOperand'] ?? c['rightOperand'];
  const v = list(right);
  const id = `${left}_${oper}`;
  if (KNOWN.has(id)) {
    return { key: `${P}c_${id}`, params: { v } };
  }
  return { key: P + 'c_generic', params: { l: left, o: oper, v } };
}

/** Describe una colección (target / assignee) con su refinamiento. */
function collectionNodes(col: any, keyPrefix: string): PolicyNode[] {
  if (col === undefined || col === null) return [];
  if (typeof col === 'string') return [{ key: P + keyPrefix + '_id', params: { v: col } }];
  const ref = col['odrl:refinement'] ?? col['refinement'];
  if (ref !== undefined) {
    return asArray(ref).map(constraintNode);
  }
  const id = valueOf(col['@id'] ?? col['odrl:source']);
  return id ? [{ key: P + keyPrefix + '_id', params: { v: id } }] : [];
}

function ruleBlock(kind: string, rule: any): PolicyBlock {
  const nodes: PolicyNode[] = [];
  const action = asArray(rule['odrl:action'] ?? rule['action']).map(a => local(valueOf(a['rdf:value'] ?? a)));
  nodes.push({ key: P + 'rule_' + kind, params: { actions: action } });

  const assigner = valueOf(rule['odrl:assigner']);
  if (assigner) nodes.push({ key: P + 'assigner', params: { v: assigner } });

  const target = collectionNodes(rule['odrl:target'] ?? rule['target'], 'target');
  if (target.length) nodes.push({ key: P + 'target', children: target });

  const who = collectionNodes(rule['odrl:assignee'] ?? rule['assignee'], 'assignee');
  nodes.push(who.length ? { key: P + 'assignee', children: who } : { key: P + 'assignee_any' });

  const cons = asArray(rule['odrl:constraint'] ?? rule['constraint']);
  if (cons.length) nodes.push({ key: P + 'constraints', children: cons.map(constraintNode) });
  return { kind, nodes };
}

function odrlBlocks(pol: any): PolicyBlock[] {
  const out: PolicyBlock[] = [];
  for (const [prefix, kind] of [['permission', 'permission'], ['prohibition', 'prohibition'], ['obligation', 'obligation']]) {
    for (const r of asArray(pol['odrl:' + prefix] ?? pol[prefix])) out.push(ruleBlock(kind, r));
  }
  return out;
}

function credentialsBlock(c: any): PolicyBlock {
  const nodes: PolicyNode[] = [];
  if (c.credentialsType) nodes.push({ key: P + 'cred_type', params: { v: c.credentialsType } });
  for (const claim of asArray(c.claims)) {
    const values = asArray(claim.allowedValues);
    nodes.push(values.length
      ? { key: P + 'cred_claim_values', params: { n: claim.name, v: values.join(', ') } }
      : { key: P + 'cred_claim', params: { n: claim.name } });
  }
  return { kind: 'credentials', nodes };
}

export function isPolicyValue(v: any): boolean {
  let x = parseMaybe(v);
  if (Array.isArray(x)) x = x[0];
  if (!x || typeof x !== 'object') return false;
  if (Array.isArray(x.claims) && 'credentialsType' in x) return true;
  const t = String(x['@type'] ?? '');
  return t.endsWith('Policy') || t.endsWith('Set') || t.endsWith('Offer') || t.endsWith('Agreement') ||
    Object.keys(x).some(k => /^(odrl:)?(permission|prohibition|obligation)$/.test(k));
}

function parseMaybe(v: any): any {
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
      try { return JSON.parse(s); } catch { return v; }
    }
  }
  return v;
}

/** Devuelve los bloques explicados; si algo no se reconoce, la lista queda vacía y la UI muestra solo el JSON. */
export function explainPolicy(raw: any): PolicyBlock[] {
  try {
    const val = parseMaybe(raw);
    const blocks: PolicyBlock[] = [];
    for (const p of asArray(val)) {
      if (!p || typeof p !== 'object') continue;
      if (Array.isArray(p.claims) && 'credentialsType' in p) blocks.push(credentialsBlock(p));
      else blocks.push(...odrlBlocks(p));
    }
    return blocks;
  } catch {
    return [];
  }
}

export function prettyJson(raw: any): string {
  const val = parseMaybe(raw);
  return JSON.stringify(val, null, 2);
}

// ── Agrupación de políticas por servicio ─────────────────────────────

export interface PolicyLike {
  id?: string
  'odrl:uid'?: string
  odrl?: string
}

export interface PolicyEntry {
  policy: PolicyLike
  /** Variante dentro del servicio (p. ej. «admin», «user») o «base». */
  variant: string
  /** Id del pedido del marketplace del que nace la política, si lo hay. */
  orderId: string | null
  /** Rutas HTTP que protege (operando http:path de la política). */
  paths: string[]
  /** Organización a la que se concede el acceso, si el UID la indica (`<host>/policy/<org>/...`). */
  grantee: string | null
  /** Etiqueta de la organización que publica la política (host del UID). */
  owner: string | null
}

export interface ServiceGroup {
  key: string
  entries: PolicyEntry[]
  paths: string[]
}

const ORDER_RE = /-urn:ngsi-ld:product-order:([0-9a-fA-F-]+)$/

function pathsOf(policy: PolicyLike): string[] {
  try {
    const o = JSON.parse(policy.odrl ?? '{}')
    const out: string[] = []
    const walk = (n: any): void => {
      if (Array.isArray(n)) return n.forEach(walk)
      if (!n || typeof n !== 'object') return
      const left = local(valueOf(n['odrl:leftOperand'] ?? n.leftOperand))
      if (left === 'path') {
        const r = valueOf(n['odrl:rightOperand'] ?? n.rightOperand)
        if (typeof r === 'string') out.push(r)
      }
      Object.values(n).forEach(walk)
    }
    walk(o)
    return [...new Set(out)]
  } catch {
    return []
  }
}

/**
 * Deduce a qué servicio pertenece una política a partir de su UID, que sigue el patrón
 * `https://<proveedor>/policy/[<organización>/]<servicio>-access[-<variante>][-urn:…:product-order:<id>]`.
 *
 * Ejemplos: `tetis-dev-access-admin` → servicio `tetis-dev`, variante `admin`;
 * `tetis/dashboard-access-urn:ngsi-ld:product-order:<id>` → `tetis-dashboard`, pedido `<id>`;
 * `ciudadania/water4cast-access` → servicio `water4cast`, concedida a `ciudadania`.
 *
 * @param orgs - Etiquetas de organizaciones conocidas (p. ej. las de la TIL), para distinguir
 *   «<organización>/servicio» de un servicio con ruta anidada como `tetis/dashboard`.
 */
export function classifyPolicy(
  policy: PolicyLike,
  orgs: readonly string[] = [],
): { service: string; entry: PolicyEntry } {
  const uid = policy['odrl:uid'] ?? policy.id ?? ''
  let tail = uid.includes('/policy/') ? uid.split('/policy/').slice(1).join('/policy/') : uid
  let owner: string | null = null
  try {
    owner = new URL(uid).host.split('.')[0] || null
  } catch {
    owner = null
  }
  let orderId: string | null = null
  const om = tail.match(ORDER_RE)
  if (om) {
    orderId = om[1]
    tail = tail.replace(ORDER_RE, '')
  }
  let grantee: string | null = null
  const slash = tail.indexOf('/')
  if (slash > 0 && orgs.includes(tail.slice(0, slash).toLowerCase())) {
    grantee = tail.slice(0, slash)
    tail = tail.slice(slash + 1)
  }
  let service = tail
  let variant = 'base'
  const m = tail.match(/^(.*?)-access(?:-([a-z0-9_]+))?$/i)
  if (m) {
    service = m[1] || tail
    variant = m[2] ?? 'base'
  }
  return {
    service: service.replace(/\//g, '-'),
    entry: { policy, variant, orderId, paths: pathsOf(policy), grantee, owner },
  }
}

export function groupPoliciesByService(
  policies: PolicyLike[],
  orgs: readonly string[] = [],
): ServiceGroup[] {
  const map = new Map<string, ServiceGroup>()
  for (const p of policies) {
    const { service, entry } = classifyPolicy(p, orgs)
    let g = map.get(service)
    if (!g) {
      g = { key: service, entries: [], paths: [] }
      map.set(service, g)
    }
    g.entries.push(entry)
    for (const path of entry.paths) if (!g.paths.includes(path)) g.paths.push(path)
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}
