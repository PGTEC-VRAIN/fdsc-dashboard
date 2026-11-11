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
 * Alcance de proveedor: el conector pertenece a una organización (su DID) y el panel
 * debe enseñar solo sus políticas, no las de otros proveedores que el PAP pueda guardar.
 *
 * El DID propio se toma del `clientId` del proveedor de identidad configurado
 * (en el despliegue es `did:web:<host>`), o de `VITE_PROVIDER_DID` en desarrollo.
 * Si no se conoce, no se filtra nada.
 */
import { loadAuthConfig } from '@/auth/config'
import type { PolicyLike } from '@/utils/policyExplainer'

const DID_WEB = 'did:web:'

function resolveOwnDid(): string | null {
  const fromEnv = (import.meta.env.VITE_PROVIDER_DID as string | undefined) ?? ''
  if (fromEnv.startsWith(DID_WEB)) return fromEnv
  // 1) DID que inyecta el BFF (PROVIDER_DID); 2) clientId del proveedor de identidad
  const injected = (window as unknown as { __USAGE_CONFIG__?: { providerDid?: string | null } }).__USAGE_CONFIG__?.providerDid
  if (injected?.startsWith(DID_WEB)) return injected
  try {
    const client = loadAuthConfig().providers.find((p) => p.clientId?.startsWith(DID_WEB))?.clientId
    return client ?? null
  } catch {
    return null
  }
}

/** Host del UID de una política (`https://<host>/policy/...`), o null. */
export function policyOwnerHost(p: PolicyLike): string | null {
  try {
    return new URL(p['odrl:uid'] ?? '').host || null
  } catch {
    return null
  }
}

export function useProviderScope() {
  const ownDid = resolveOwnDid()
  const ownHost = ownDid ? ownDid.slice(DID_WEB.length) : null
  /** Etiqueta corta de la organización: «iiama». */
  const ownLabel = ownHost ? ownHost.split('.')[0] : null

  /** ¿La política la ha publicado este proveedor? Sin DID propio, todas lo son. */
  function isOwn(p: PolicyLike): boolean {
    return !ownHost || policyOwnerHost(p) === ownHost
  }

  return { ownDid, ownHost, ownLabel, hasScope: !!ownHost, isOwn }
}
