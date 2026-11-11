<template>
  <div>
    <v-alert
      type="info"
      variant="tonal"
      density="compact"
      class="mb-4"
      icon="mdi-lightbulb-on-outline"
    >
      {{ t('policy.bySvc.derivedHint') }}
    </v-alert>

    <div class="d-flex align-center flex-wrap ga-4 mb-4">
      <v-text-field
        v-model="filter"
        :label="t('common.search')"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="comfortable"
        hide-details
        clearable
        class="flex-grow-1"
      />
      <v-switch
        v-if="scope.hasScope"
        v-model="onlyOwn"
        color="primary"
        hide-details
        density="comfortable"
        :label="t('policy.bySvc.onlyOwn', { org: ownName })"
      />
    </div>
    <div v-if="scope.hasScope && onlyOwn && hiddenCount" class="text-caption text-medium-emphasis mb-3">
      {{ t('policy.bySvc.hidden', { n: hiddenCount }) }}
    </div>

    <v-skeleton-loader v-if="store.allLoading && !store.allPolicies.length" type="card, card" />
    <v-alert v-else-if="store.allError" type="error" variant="tonal">{{ store.allError }}</v-alert>
    <div v-else-if="!groups.length" class="text-center text-medium-emphasis py-10">
      <v-icon size="56">mdi-folder-open-outline</v-icon>
      <div class="mt-2">{{ t('policies.noPolicies') }}</div>
    </div>

    <v-expansion-panels v-else v-model="open" multiple variant="accordion" class="svc-panels">
      <v-expansion-panel v-for="g in groups" :key="g.key" :value="g.key" rounded="lg" class="mb-3">
        <v-expansion-panel-title>
          <div class="d-flex align-center w-100 ga-3 flex-wrap">
            <v-avatar color="primary" variant="tonal" size="40">
              <v-icon>mdi-api</v-icon>
            </v-avatar>
            <div>
              <div class="text-h6 svc-name">{{ pretty(g.key) }}</div>
              <div v-if="g.paths.length" class="text-caption text-medium-emphasis">
                {{ t('policy.bySvc.accessPath') }}:
                <code v-for="p in g.paths" :key="p" class="mr-2">{{ p }}</code>
              </div>
            </div>
            <v-spacer />
            <v-chip size="small" color="primary" variant="flat">
              {{ t('policy.bySvc.policiesCount', { n: g.entries.length }) }}
            </v-chip>
          </div>
        </v-expansion-panel-title>

        <v-expansion-panel-text>
          <v-row>
            <v-col v-for="e in g.entries" :key="e.policy.id" cols="12" md="6" lg="4">
              <v-card variant="outlined" class="h-100 d-flex flex-column">
                <v-card-item>
                  <div class="d-flex align-center flex-wrap ga-2">
                    <v-chip size="small" :color="variantColor(e.variant)" variant="tonal" label>
                      {{ e.variant === 'base' ? t('policy.bySvc.base') : e.variant }}
                    </v-chip>
                    <v-chip
                      v-if="e.grantee"
                      size="small"
                      variant="outlined"
                      prepend-icon="mdi-account-arrow-right-outline"
                    >
                      {{ t('policy.bySvc.grantedTo', { org: orgName(e.grantee) }) }}
                    </v-chip>
                    <v-chip
                      v-if="!scope.hasScope && e.owner"
                      size="small"
                      variant="outlined"
                      prepend-icon="mdi-domain"
                    >
                      {{ orgName(e.owner) }}
                    </v-chip>
                    <v-chip
                      v-if="e.orderId"
                      size="small"
                      variant="outlined"
                      prepend-icon="mdi-cart-outline"
                      :title="e.orderId"
                    >
                      {{ t('policy.bySvc.orderTag') }} · {{ e.orderId.slice(0, 8) }}
                    </v-chip>
                  </div>
                </v-card-item>
                <v-card-text class="flex-grow-1">
                  <PolicyExplained :value="e.policy.odrl" />
                </v-card-text>
                <v-card-actions>
                  <v-btn
                    variant="text"
                    color="primary"
                    size="small"
                    append-icon="mdi-arrow-right"
                    :to="{ name: 'policy-detail', params: { id: e.policy.id } }"
                  >
                    {{ t('common.details') }}
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-col>
          </v-row>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </div>
</template>

<script setup lang="ts">
/**
 * Políticas agrupadas por el servicio que protegen. El ODRL-PAP de este despliegue no
 * tiene «servicios» registrados, así que el servicio se deduce del UID de cada política.
 */
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePoliciesStore } from '@/stores/policies'
import { useTilStore } from '@/stores/til'
import { useProviderScope } from '@/composables/useProviderScope'
import PolicyExplained from '@/components/PolicyExplained.vue'
import { groupPoliciesByService } from '@/utils/policyExplainer'

const { t } = useI18n()
const store = usePoliciesStore()
const tilStore = useTilStore()
const scope = useProviderScope()
const onlyOwn = ref(true)
const filter = ref('')

/** Etiquetas de organizaciones conocidas (de la TIL), para reconocer «<org>/servicio». */
const orgs = computed(() =>
  tilStore.issuers
    .map((i) => (i.did ?? '').replace(/^did:web:/, '').split('.')[0].toLowerCase())
    .filter(Boolean),
)
/** «iiama» → «IIAMA»; «ciudadania» → «Ciudadania». Sin tablas por proveedor, vale para cualquier despliegue. */
const orgName = (l: string): string => (l.length <= 6 ? l.toUpperCase() : l.charAt(0).toUpperCase() + l.slice(1))
const ownName = computed(() => (scope.ownLabel ? orgName(scope.ownLabel) : ''))

const visiblePolicies = computed(() =>
  scope.hasScope && onlyOwn.value ? store.allPolicies.filter((p) => scope.isOwn(p)) : store.allPolicies,
)
const hiddenCount = computed(() => store.allPolicies.length - store.allPolicies.filter((p) => scope.isOwn(p)).length)
const open = ref<string[]>([])

const groups = computed(() => {
  const q = (filter.value ?? '').toLowerCase().trim()
  const all = groupPoliciesByService(visiblePolicies.value, orgs.value)
  return q
    ? all.filter(
        (g) =>
          g.key.toLowerCase().includes(q) ||
          g.paths.some((p) => p.toLowerCase().includes(q)) ||
          g.entries.some((e) => (e.policy.id ?? '').toLowerCase().includes(q) || (e.orderId ?? '').includes(q)),
      )
    : all
})

const pretty = (k: string): string =>
  k
    .split('/')
    .map((s) => s.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()))
    .join(' / ')

const variantColor = (v: string): string =>
  v === 'admin' ? 'error' : v === 'user' ? 'success' : v === 'base' ? 'primary' : 'secondary'

onMounted(() => {
  if (!store.allPolicies.length) store.fetchAllPolicies()
  if (!tilStore.issuers.length) tilStore.fetchIssuers(0, 100)
})
</script>
