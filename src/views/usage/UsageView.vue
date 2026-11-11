<template>
  <div>
    <div class="d-flex align-center flex-wrap ga-3 mb-2">
      <h1 class="text-h4">{{ t('usage.title') }}</h1>
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="mdi-refresh" :loading="loading" @click="load">
        {{ t('common.refresh') }}
      </v-btn>
    </div>
    <p class="text-subtitle-1 text-medium-emphasis mb-4">{{ t('usage.subtitle') }}</p>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="orders"><v-icon start>mdi-cart-outline</v-icon>{{ t('usage.orders') }}</v-tab>
      <v-tab value="access"><v-icon start>mdi-lan-connect</v-icon>{{ t('usage.access') }}</v-tab>
    </v-tabs>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <v-window v-model="tab">
      <!-- Pedidos -->
      <v-window-item value="orders">
        <v-alert v-if="!features.orders" type="info" variant="tonal">{{ t('usage.ordersOff') }}</v-alert>
        <template v-else>
          <div class="d-flex flex-wrap ga-3 mb-4">
            <v-card v-for="s in orderStates" :key="s.key" class="stat-tile pa-4">
              <div class="text-h4 font-weight-bold" :class="'text-' + stateColor(s.key)">{{ s.count }}</div>
              <div class="text-caption text-medium-emphasis">{{ stateLabel(s.key) }}</div>
            </v-card>
          </div>
          <v-card>
            <v-data-table
              :headers="orderHeaders"
              :items="orders"
              :loading="loading"
              :no-data-text="t('usage.noOrders')"
              item-value="id"
              density="comfortable"
            >
              <template #[`item.date`]="{ item }">{{ fmt(item.date) }}</template>
              <template #[`item.state`]="{ item }">
                <v-chip size="small" :color="stateColor(item.state)" variant="tonal" label>
                  {{ stateLabel(item.state) }}
                </v-chip>
              </template>
              <template #[`item.items`]="{ item }">
                <div v-for="(it, i) in item.items" :key="i">{{ it.offeringName || it.offeringId }}</div>
              </template>
              <template #[`item.buyer`]="{ item }">{{ buyerOf(item) }}</template>
              <template #[`item.id`]="{ item }"><code :title="item.id">{{ shortId(item.id) }}</code></template>
            </v-data-table>
          </v-card>
        </template>
      </v-window-item>

      <!-- Accesos -->
      <v-window-item value="access">
        <v-alert v-if="!features.accessLogs" type="info" variant="tonal">{{ t('usage.accessOff') }}</v-alert>
        <template v-else>
          <div class="d-flex align-center flex-wrap ga-4 mb-4">
            <v-btn-toggle v-model="range" mandatory color="primary" variant="outlined" density="comfortable" @update:model-value="load">
              <v-btn v-for="r in ranges" :key="r.value" :value="r.value">{{ r.label }}</v-btn>
            </v-btn-toggle>
            <v-switch v-model="auto" color="primary" hide-details density="comfortable" :label="t('usage.autoRefresh')" />
          </div>

          <div class="d-flex flex-wrap ga-3 mb-4">
            <v-card class="stat-tile pa-4">
              <div class="text-h4 font-weight-bold text-primary">{{ entries.length }}</div>
              <div class="text-caption text-medium-emphasis">{{ t('usage.requests') }}</div>
            </v-card>
            <v-card class="stat-tile pa-4">
              <div class="text-h4 font-weight-bold text-primary">{{ distinctUsers }}</div>
              <div class="text-caption text-medium-emphasis">{{ t('usage.users') }}</div>
            </v-card>
            <v-card v-for="c in statusClasses" :key="c.key" class="stat-tile pa-4">
              <div class="text-h4 font-weight-bold" :class="'text-' + c.color">{{ c.count }}</div>
              <div class="text-caption text-medium-emphasis">{{ c.label }}</div>
            </v-card>
          </div>

          <v-row>
            <v-col cols="12" md="4">
              <v-card class="pa-4 h-100">
                <div class="text-subtitle-1 font-weight-bold mb-3">{{ t('usage.byService') }}</div>
                <div v-if="!byService.length" class="text-medium-emphasis">{{ t('usage.noAccess') }}</div>
                <div v-for="s in byService" :key="s.key" class="mb-3">
                  <div class="d-flex justify-space-between text-body-2">
                    <code>/{{ s.key }}</code><span>{{ s.count }}</span>
                  </div>
                  <v-progress-linear :model-value="(s.count / maxService) * 100" color="primary" height="8" rounded />
                </div>
              </v-card>
              <v-card class="pa-4 mt-4">
                <div class="text-subtitle-1 font-weight-bold mb-3">{{ t('usage.byOrg') }}</div>
                <div v-if="!byOrg.length" class="text-medium-emphasis">{{ t('usage.noIdentity') }}</div>
                <div v-for="o in byOrg" :key="o.key" class="mb-3">
                  <div class="d-flex justify-space-between text-body-2">
                    <span>{{ orgLabel(o.key) }}</span><span>{{ o.count }}</span>
                  </div>
                  <v-progress-linear :model-value="(o.count / maxOrg) * 100" color="accent" height="8" rounded />
                </div>
              </v-card>
            </v-col>
            <v-col cols="12" md="8">
              <v-card>
                <v-data-table
                  :headers="accessHeaders"
                  :items="entries"
                  :loading="loading"
                  :no-data-text="t('usage.noAccess')"
                  :items-per-page="15"
                  density="compact"
                  class="access-table"
                >
                  <template #[`item.time`]="{ item }">{{ fmt(item.time) }}</template>
                  <template #[`item.method`]="{ item }"><v-chip size="x-small" label>{{ item.method }}</v-chip></template>
                  <template #[`item.who`]="{ item }">
                    <div v-if="item.identity" :title="item.identity.subject ?? ''">
                      <div class="font-weight-medium">{{ whoOf(item) }}</div>
                      <div v-if="item.identity.credentialTypes.length" class="text-caption text-medium-emphasis">
                        {{ item.identity.credentialTypes.join(', ') }}
                      </div>
                    </div>
                    <span v-else class="text-medium-emphasis">{{ t('usage.anonymous') }}</span>
                  </template>
                  <template #[`item.roles`]="{ item }">
                    <v-chip v-for="r in item.identity?.roles ?? []" :key="r" size="x-small" variant="tonal" color="primary" class="mr-1 mb-1" label>{{ r }}</v-chip>
                  </template>
                  <template #[`item.org`]="{ item }">
                    <v-chip v-if="item.identity?.organization" size="x-small" variant="outlined" prepend-icon="mdi-domain" :title="item.identity.organization">
                      {{ orgLabel(item.identity.organization) }}
                    </v-chip>
                  </template>
                  <template #[`item.path`]="{ item }"><code class="path">{{ item.path }}</code></template>
                  <template #[`item.status`]="{ item }">
                    <v-chip size="x-small" :color="statusColor(item.status)" variant="flat" label>{{ item.status }}</v-chip>
                  </template>
                  <template #[`item.seconds`]="{ item }">{{ Math.round(item.seconds * 1000) }} ms</template>
                </v-data-table>
              </v-card>
            </v-col>
          </v-row>
        </template>
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup lang="ts">
/**
 * Registro de uso del conector: pedidos del marketplace (TM Forum) y accesos a los
 * servicios (log de acceso de APISIX). Todo llega por el BFF; nada es específico de un proveedor.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  countBy,
  fetchAccess,
  fetchOrders,
  loadUsageFeatures,
  orgLabel,
  whoOf,
  serviceOfPath,
  type AccessEntry,
  type OrderSummary,
} from '@/composables/useUsage'

const { t, te } = useI18n()
const features = loadUsageFeatures()

const tab = ref(features.orders || !features.accessLogs ? 'orders' : 'access')
const loading = ref(false)
const error = ref<string | null>(null)
const orders = ref<OrderSummary[]>([])
const entries = ref<AccessEntry[]>([])
const range = ref(3600)
const auto = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

const ranges = computed(() => [
  { value: 3600, label: t('usage.range1h') },
  { value: 6 * 3600, label: t('usage.range6h') },
  { value: 24 * 3600, label: t('usage.range24h') },
  { value: 7 * 86400, label: t('usage.range7d') },
])

const orderHeaders = computed(() => [
  { title: t('usage.date'), key: 'date', sortable: true },
  { title: t('common.status'), key: 'state', sortable: true },
  { title: t('usage.offers'), key: 'items', sortable: false },
  { title: t('usage.buyer'), key: 'buyer', sortable: false },
  { title: t('common.id'), key: 'id', sortable: false },
])
const accessHeaders = computed(() => [
  { title: t('usage.date'), key: 'time' },
  { title: t('usage.method'), key: 'method' },
  { title: t('usage.path'), key: 'path' },
  { title: t('usage.who'), key: 'who', sortable: false },
  { title: t('usage.roles'), key: 'roles', sortable: false },
  { title: t('usage.organization'), key: 'org', sortable: false },
  { title: t('common.status'), key: 'status' },
  { title: t('usage.latency'), key: 'seconds' },
  { title: 'IP', key: 'ip' },
])

const orderStates = computed(() => countBy(orders.value, (o) => o.state))
const byService = computed(() => countBy(entries.value, (e) => serviceOfPath(e.path)).slice(0, 8))
const distinctUsers = computed(() => new Set(entries.value.map(whoOf).filter(Boolean)).size)
const byOrg = computed(() =>
  countBy(entries.value.filter((e) => e.identity?.organization), (e) => e.identity!.organization!).slice(0, 8),
)
const maxOrg = computed(() => Math.max(1, ...byOrg.value.map((o) => o.count)))
const maxService = computed(() => Math.max(1, ...byService.value.map((s) => s.count)))
const statusClasses = computed(() => {
  const n = (lo: number, hi: number) => entries.value.filter((e) => e.status >= lo && e.status < hi).length
  return [
    { key: '2xx', label: t('usage.ok'), count: n(200, 400), color: 'success' },
    { key: '4xx', label: t('usage.denied'), count: n(400, 500), color: 'warning' },
    { key: '5xx', label: t('usage.errors'), count: n(500, 600), color: 'error' },
  ]
})

const STATE_COLORS: Record<string, string> = {
  completed: 'success', inprogress: 'info', acknowledged: 'info', pending: 'warning',
  failed: 'error', rejected: 'error', cancelled: 'secondary', held: 'warning',
}
const stateColor = (s: string): string => STATE_COLORS[s.toLowerCase()] ?? 'primary'
const stateLabel = (s: string): string => (te('usage.state.' + s.toLowerCase()) ? t('usage.state.' + s.toLowerCase()) : s)
const statusColor = (s: number): string => (s >= 500 ? 'error' : s >= 400 ? 'warning' : 'success')
const shortId = (id: string): string => id.split(':').pop()?.slice(0, 8) ?? id
const fmt = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '—')

/** Comprador: la parte relacionada que no es el propio proveedor. */
function buyerOf(o: OrderSummary): string {
  const own = (features.providerDid ?? '').replace(/^did:web:/, '').toLowerCase()
  const p = o.parties.find((x) => !own || !`${x.id} ${x.name}`.toLowerCase().includes(own)) ?? o.parties[0]
  return p ? p.name || p.id : '—'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    if (tab.value === 'orders' && features.orders) orders.value = (await fetchOrders()).orders
    if (tab.value === 'access' && features.accessLogs) entries.value = (await fetchAccess(range.value)).entries
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

watch(tab, load)
watch(auto, (on) => {
  clearInterval(timer)
  if (on) timer = setInterval(load, 30000)
})
onMounted(load)
onBeforeUnmount(() => clearInterval(timer))
</script>

<style scoped>
.stat-tile { min-width: 140px; }
.path { word-break: break-all; }
</style>
