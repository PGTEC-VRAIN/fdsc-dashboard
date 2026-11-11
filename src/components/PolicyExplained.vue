<template>
  <div class="pe-root">
    <div class="pe-head">
      <span class="pe-title">{{ blocks.length ? t('policy.explained') : '' }}</span>
      <v-btn
        icon
        size="x-small"
        variant="outlined"
        :aria-label="t('policy.show_json')"
        :title="t('policy.show_json')"
        :color="showJson ? 'primary' : undefined"
        @click="showJson = !showJson"
      >
        <v-icon size="16">mdi-information-variant</v-icon>
      </v-btn>
    </div>

    <p v-if="!blocks.length" class="text-body-2 text-medium-emphasis mb-2">
      {{ t('policy.not_explained') }}
    </p>

    <div v-for="(b, i) in blocks" :key="i" class="pe-block" :class="'pe-' + b.kind">
      <ul class="pe-list">
        <PolicyNodeItem v-for="(n, j) in b.nodes" :key="j" :node="n" />
      </ul>
    </div>

    <CodeBlock v-if="showJson" :code="json" :title="t('policy.json')" />
  </div>
</template>

<script setup lang="ts">
/**
 * Muestra una política ODRL o de credenciales como frases en lenguaje natural.
 * El JSON original queda tras el icono (i), con un bloque de código estilo Carbon.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import CodeBlock from '@/components/CodeBlock.vue'
import PolicyNodeItem from '@/components/PolicyNodeItem.vue'
import { explainPolicy, prettyJson } from '@/utils/policyExplainer'

const props = defineProps<{ value: unknown; startOpen?: boolean }>()
const { t } = useI18n()

const blocks = computed(() => explainPolicy(props.value))
const json = computed(() => prettyJson(props.value))
const showJson = ref(!!props.startOpen)
// Si no se puede explicar, enseñamos el JSON directamente
watch(blocks, (b) => { if (!b.length) showJson.value = true }, { immediate: true })
</script>

<style scoped>
.pe-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: .4rem; }
.pe-title { font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; opacity: .65; font-weight: 600; }
.pe-block { border-left: 4px solid rgb(var(--v-theme-primary)); background: rgba(var(--v-theme-primary), .07); border-radius: 0 10px 10px 0; padding: .6rem .9rem; margin-bottom: .6rem; }
.pe-prohibition { border-left-color: rgb(var(--v-theme-error)); background: rgba(var(--v-theme-error), .07); }
.pe-credentials { border-left-color: rgb(var(--v-theme-success)); background: rgba(var(--v-theme-success), .07); }
.pe-list { list-style: none; margin: 0; padding: 0; }
</style>
