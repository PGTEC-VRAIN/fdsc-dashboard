<template>
  <li class="pn-item">
    <span class="pn-text">{{ text }}</span>
    <ul v-if="node.children?.length" class="pn-children">
      <PolicyNodeItem v-for="(c, i) in node.children" :key="i" :node="c" />
    </ul>
  </li>
</template>

<script setup lang="ts">
/** Nodo recursivo del árbol de frases de una política. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PolicyNode } from '@/utils/policyExplainer'

defineOptions({ name: 'PolicyNodeItem' })
const props = defineProps<{ node: PolicyNode }>()
const { t, te } = useI18n()

const text = computed(() => {
  const params: Record<string, unknown> = { ...(props.node.params ?? {}) }
  const actions = params.actions as string[] | undefined
  if (actions) {
    params.a = actions
      .map((x) => (te('policy.action_' + x) ? t('policy.action_' + x) : x))
      .join(', ')
  }
  return t(props.node.key, params)
})
</script>

<style scoped>
.pn-item { position: relative; padding: .12rem 0 .12rem 1rem; line-height: 1.45; }
.pn-item::before { content: ''; position: absolute; left: 0; top: .72em; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .45; }
.pn-children { list-style: none; margin: .15rem 0 .1rem .2rem; padding: 0 0 0 .6rem; border-left: 1px dashed rgba(128,128,128,.4); }
</style>
