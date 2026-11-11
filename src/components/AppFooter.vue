<template>
  <footer class="app-footer">
    <div class="app-footer-shell">
      <div class="app-footer-logos">
        <a href="https://next-generation-eu.europa.eu/index_es" target="_blank" rel="noopener noreferrer">
          <img src="/logos/logo_EU-NG_es.png" :alt="t('footer.eu')" />
        </a>
        <a href="https://avance.digital.gob.es/" target="_blank" rel="noopener noreferrer">
          <img src="/logos/logo_MTDFP-SEDIA.png" :alt="t('footer.ministry')" />
        </a>
        <a href="https://planderecuperacion.gob.es/" target="_blank" rel="noopener noreferrer">
          <img src="/logos/logo_PRTR.png" :alt="t('footer.prtr')" />
        </a>
        <a href="https://www.upv.es/" target="_blank" rel="noopener noreferrer">
          <img src="/logos/logo_UPV.png" alt="Universitat Politècnica de València" />
        </a>
        <a href="https://vrain.upv.es/" target="_blank" rel="noopener noreferrer">
          <img class="app-footer-vrain" src="/logos/logo_VRAIN.png" alt="VRAIN" />
        </a>
        <a
          href="https://cred.digital.gob.es/espacios-de-datos/lista-de-confianza-de-espacios-de-datos"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img src="/logos/logo_EDC.svg" :alt="t('footer.edc')" />
        </a>
      </div>
      <p class="app-footer-funding">{{ t('footer.funding') }}</p>
    </div>
  </footer>
</template>

<script setup lang="ts">
/** Pie con los logos del espacio de datos y de sus financiadores (los mismos que el marketplace). */
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<style scoped>
.app-footer-shell { max-width: 1400px; margin: 32px auto 0; padding: 0 16px 24px; }
/* Los logos conservan sus colores, así que van sobre una banda blanca en claro y oscuro */
.app-footer-logos { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px 32px; padding: 18px 24px; border-radius: 16px; background: #fff; border: 1px solid rgba(128, 128, 128, 0.25); }
.app-footer-logos a { display: inline-flex; align-items: center; }
.app-footer-logos img { height: 38px; width: auto; max-width: 220px; object-fit: contain; }
.app-footer-logos img.app-footer-vrain { height: 22px; max-width: 260px; }
.app-footer-funding { margin: 14px 0 0; font-size: 0.85rem; opacity: 0.7; }
@media (min-width: 1160px) { .app-footer-logos { flex-wrap: nowrap; gap: 20px; } }
</style>
