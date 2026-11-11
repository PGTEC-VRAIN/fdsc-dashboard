<template>
  <div class="role-chips">
    <v-chip v-for="r in shown" :key="r" size="x-small" variant="tonal" color="primary" class="mr-1 mb-1" label>{{ r }}</v-chip>
    <v-tooltip v-if="rest.length" location="top" max-width="360">
      <template #activator="{ props: tip }">
        <v-chip v-bind="tip" size="x-small" variant="outlined" class="mb-1" label>+{{ rest.length }}</v-chip>
      </template>
      <span>{{ rest.join(', ') }}</span>
    </v-tooltip>
  </div>
</template>

<script setup lang="ts">
/** Roles de una persona: los primeros `max` como chips y el resto en un «+N» con tooltip. */
import { computed } from 'vue'

const props = withDefaults(defineProps<{ roles: string[]; max?: number }>(), { max: 3 })
const shown = computed(() => props.roles.slice(0, props.max))
const rest = computed(() => props.roles.slice(props.max))
</script>
