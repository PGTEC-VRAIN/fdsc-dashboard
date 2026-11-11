<template>
  <div class="cb-root" role="region" :aria-label="title">
    <div class="cb-bar">
      <span class="cb-dot cb-dot-r" /><span class="cb-dot cb-dot-y" /><span class="cb-dot cb-dot-g" />
      <span class="cb-name">{{ title }}</span>
      <button type="button" class="cb-copy" @click="copy">
        {{ copied ? t('policy.copied') : t('policy.copy') }}
      </button>
    </div>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <pre class="cb-pre" :style="{ maxHeight }"><code v-html="html" /></pre>
  </div>
</template>

<script setup lang="ts">
/**
 * Bloque de código al estilo Carbon (carbon.now.sh): ventana oscura con tres puntos,
 * resaltado JSON y botón de copiar. Es texto real, se puede seleccionar y copiar.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{ code: string; title?: string; maxHeight?: string }>(), {
  title: 'JSON',
  maxHeight: '24rem',
})

const { t } = useI18n()
const copied = ref(false)

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const html = computed(() =>
  esc(props.code).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (_m, str, colon, lit, num) => {
      if (str) return colon ? `<span class="cb-k">${str}</span>${colon}` : `<span class="cb-s">${str}</span>`
      if (lit) return `<span class="cb-l">${lit}</span>`
      return `<span class="cb-n">${num}</span>`
    },
  ),
)

function copy(): void {
  navigator.clipboard
    ?.writeText(props.code)
    .then(() => {
      copied.value = true
      setTimeout(() => (copied.value = false), 1500)
    })
    .catch(() => undefined)
}
</script>

<style scoped>
.cb-root { margin: .5rem 0; border-radius: 12px; overflow: hidden; background: #181818; box-shadow: 0 10px 30px rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.08); text-align: left; }
.cb-bar { display: flex; align-items: center; gap: .4rem; padding: .55rem .8rem; background: #1f1f1f; }
.cb-dot { width: .7rem; height: .7rem; border-radius: 9999px; display: inline-block; }
.cb-dot-r { background: #ff5f56; } .cb-dot-y { background: #ffbd2e; } .cb-dot-g { background: #27c93f; }
.cb-name { margin-left: .5rem; font: .75rem ui-monospace, monospace; color: #9ca3af; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cb-copy { font-size: .72rem; color: #d1d5db; border: 1px solid #4b5563; border-radius: 6px; padding: .1rem .6rem; background: transparent; cursor: pointer; }
.cb-copy:hover { background: #374151; }
.cb-copy:focus-visible { outline: 2px solid #818cf8; outline-offset: 2px; }
.cb-pre { margin: 0; padding: 1rem 1.1rem; overflow: auto; font: .8rem/1.6 ui-monospace, 'Fira Code', Menlo, monospace; color: #e5e7eb; white-space: pre; }
.cb-pre :deep(.cb-k) { color: #7dd3fc; } .cb-pre :deep(.cb-s) { color: #a5d6a7; } .cb-pre :deep(.cb-n) { color: #f9a8d4; } .cb-pre :deep(.cb-l) { color: #fbbf24; }
</style>
