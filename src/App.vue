<script setup lang="ts">
import { computed, onBeforeMount, onMounted, onBeforeUnmount, ref } from 'vue';
import Collapsable from './components/Collapsable.vue';
import MainMap from './components/MainMap.vue';
import Sidebar from './components/Sidebar.vue';
import { useLoadedDimensionStore } from './stores/useLoadedDimensionStore';
import { useUiStore } from './stores/useUiStore';
import Popup from './components/Popup.vue';
import ModrinthMenu from './components/modrinth/ModrinthMenu.vue';

const loaded = ref(false)
const sidebarOpen = ref(true)
const sidebarWidth = ref(26)
const showIntro = ref(false)
const hideIntroNextStartup = ref(false)
const introStorageKey = 'prism-worldgen-lab.hide-public-intro.v1'

const uiStore = useUiStore()

const layoutStyle = computed(() => ({
  '--sidebar-width': `${sidebarWidth.value}rem`
}))

function startSidebarResize(event: PointerEvent) {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = sidebarWidth.value
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16

  function move(moveEvent: PointerEvent) {
    const deltaRem = (moveEvent.clientX - startX) / rootFontSize
    sidebarWidth.value = Math.max(18, Math.min(42, startWidth + deltaRem))
  }

  function stop() {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}

function openIntro() {
  hideIntroNextStartup.value = localStorage.getItem(introStorageKey) === '1'
  showIntro.value = true
}

function closeIntro() {
  if (hideIntroNextStartup.value) {
    localStorage.setItem(introStorageKey, '1')
  } else {
    localStorage.removeItem(introStorageKey)
  }
  showIntro.value = false
}

function handleHelpEvent() {
  openIntro()
}

onBeforeMount(async () => {
  const loadedDimensionStore = useLoadedDimensionStore()
  await loadedDimensionStore.reload()
  loaded.value = true

})

onMounted(() => {
  window.addEventListener('prism-worldgen-lab-help', handleHelpEvent)
  if (localStorage.getItem(introStorageKey) !== '1') {
    openIntro()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('prism-worldgen-lab-help', handleHelpEvent)
})

</script>

<template>
  <div class="layout" v-if="loaded" :style="layoutStyle">
    <Collapsable v-model="sidebarOpen">
      <Sidebar />
    </Collapsable>
    <div
      v-if="sidebarOpen"
      class="sidebar-resize-handle"
      title="Resize PRISM Lab workspace"
      @pointerdown="startSidebarResize"
    ></div>
    <MainMap />
    <div v-if="showIntro" class="intro-backdrop">
      <section class="intro-dialog" role="dialog" aria-modal="true" aria-labelledby="intro-title">
        <header>
          <div>
            <p class="eyebrow">Public testing build</p>
            <h1 id="intro-title">PRISM Worldgen Lab</h1>
          </div>
          <button class="intro-close" title="Close" @click="closeIntro">
            <font-awesome-icon icon="fa-xmark" />
          </button>
        </header>

        <div class="intro-grid">
          <article>
            <h2>1. Load your worldgen sources</h2>
            <p>Use the plus button to load the map/worldgen mod jar you want to inspect. The public build does not auto-load or bundle Lithosphere, Still Life, or any PRISM experimental datapacks.</p>
          </article>
          <article>
            <h2>2. Configure presets</h2>
            <p>The Preset Mixer applies safe curated Lithosphere 1.6 values per category. Other loaded mods expose their own editable noise and density-function namespaces when those resources are datapack-driven.</p>
          </article>
          <article>
            <h2>3. Inspect the result</h2>
            <p>Use Compare, Difference, Heightmap, Cave view, clip warnings, biome search, and the Y slider to check terrain, peaks, rivers, coasts, caves, and possible height-limit clipping.</p>
          </article>
          <article>
            <h2>4. Export for Minecraft</h2>
            <p>Use the highlighted datapack export button. Desktop exports are saved to Documents/PRISM Worldgen Lab/Datapacks and the folder opens automatically.</p>
          </article>
        </div>

        <div class="intro-warning">
          <strong>Theme warning:</strong>
          Themes are broad experimental combinations. They are not fully tested and should normally be used alone, not stacked with other preset categories.
        </div>

        <label class="intro-check">
          <input type="checkbox" v-model="hideIntroNextStartup" />
          Do not show this again on startup
        </label>

        <footer>
          <button class="secondary" @click="hideIntroNextStartup = false">Show on startup again</button>
          <button class="primary" @click="closeIntro">Start testing</button>
        </footer>
      </section>
    </div>
  </div>
  <div class="layout loading" v-else>
    <p>Loading...</p>
  </div>
</template>

<style scoped>
.layout {
  width: 100%;
  height: 100%;
  display: flex;
  --sidebar-width: 26rem;
  background: var(--prism-bg);
}

.sidebar-resize-handle {
  position: absolute;
  z-index: 5002;
  left: calc(var(--sidebar-width, 26rem) - 0.18rem);
  top: 0;
  width: 0.36rem;
  height: 100%;
  cursor: ew-resize;
  background: transparent;
}

.sidebar-resize-handle:hover,
.sidebar-resize-handle:active {
  background: linear-gradient(
    90deg,
    transparent,
    rgba(54, 214, 230, 0.72),
    transparent
  );
}

.loading{
  font-size: 5rem;
  color: white;
  align-items: center;
  justify-content: center;
}

p{
  height: fit-content;
}

.intro-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: 2rem;
  background: rgba(0, 9, 13, 0.72);
  backdrop-filter: blur(0.25rem);
}

.intro-dialog {
  width: min(58rem, 100%);
  max-height: calc(100vh - 4rem);
  overflow: auto;
  box-sizing: border-box;
  padding: 1.25rem;
  border: 1px solid var(--prism-border);
  border-radius: 0.5rem;
  background: linear-gradient(180deg, rgba(12, 70, 88, 0.98), rgba(4, 29, 38, 0.98));
  color: var(--prism-text);
  box-shadow: 0 1rem 4rem rgba(0, 0, 0, 0.45);
}

.intro-dialog header,
.intro-dialog footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.intro-dialog h1,
.intro-dialog h2,
.intro-dialog p {
  margin: 0;
}

.intro-dialog h1 {
  font-size: 1.8rem;
}

.intro-dialog h2 {
  font-size: 1rem;
  color: var(--prism-accent-2);
}

.eyebrow {
  color: var(--prism-active);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0;
}

.intro-close {
  min-width: 2.25rem;
  min-height: 2.25rem;
  padding: 0;
  border: 1px solid var(--prism-border);
  background: var(--prism-panel-3);
  color: var(--prism-text);
}

.intro-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin-top: 1rem;
}

.intro-grid article,
.intro-warning {
  padding: 0.8rem;
  border: 1px solid var(--prism-border-soft);
  border-radius: 0.35rem;
  background: rgba(2, 20, 27, 0.55);
}

.intro-grid p,
.intro-warning,
.intro-check {
  color: var(--prism-muted);
  line-height: 1.45;
}

.intro-warning {
  margin-top: 0.8rem;
  color: rgb(255, 222, 164);
}

.intro-check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.85rem;
}

.intro-dialog footer {
  margin-top: 1rem;
}

.intro-dialog .primary,
.intro-dialog .secondary {
  border: 1px solid var(--prism-border);
  color: var(--prism-text);
}

.intro-dialog .primary {
  background: var(--prism-accent);
  color: rgb(2, 17, 22);
}

.intro-dialog .secondary {
  background: var(--prism-panel-3);
}

@media (max-width: 760px) {
  .intro-grid {
    grid-template-columns: 1fr;
  }
}
</style>
