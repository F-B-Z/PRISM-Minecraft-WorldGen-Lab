<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

type UpdatePhase = 'available' | 'downloading' | 'installing' | 'restarting' | 'error'

const update = shallowRef<Update | null>(null)
const visible = ref(false)
const phase = ref<UpdatePhase>('available')
const errorMessage = ref('')
const downloadProgress = ref(0)
const downloadedBytes = ref(0)
const totalBytes = ref<number | null>(null)

let checkedThisStartup = false

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function handleDownloadEvent(event: DownloadEvent) {
  if (event.event === 'Started') {
    downloadedBytes.value = 0
    totalBytes.value = event.data.contentLength ?? null
    downloadProgress.value = totalBytes.value ? 1 : 0
  } else if (event.event === 'Progress') {
    downloadedBytes.value += event.data.chunkLength
    if (totalBytes.value) {
      downloadProgress.value = Math.min(100, Math.round((downloadedBytes.value / totalBytes.value) * 100))
    }
  } else if (event.event === 'Finished') {
    downloadProgress.value = 100
  }
}

async function installUpdate() {
  if (!update.value || phase.value === 'downloading' || phase.value === 'installing') return

  try {
    phase.value = 'downloading'
    errorMessage.value = ''
    await update.value.download(handleDownloadEvent, { timeout: 120000 })
    phase.value = 'installing'
    await update.value.install()
    phase.value = 'restarting'
    await relaunch()
  } catch (error) {
    phase.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
}

function dismissUpdate() {
  visible.value = false
}

async function checkForUpdateOnce() {
  if (checkedThisStartup || !isTauriRuntime()) return
  checkedThisStartup = true

  try {
    const nextUpdate = await check({ timeout: 10000 })
    if (!nextUpdate) return

    update.value = nextUpdate
    phase.value = 'available'
    visible.value = true
  } catch (error) {
    console.info('PRISM Worldgen Lab update check skipped:', error)
  }
}

onMounted(() => {
  void checkForUpdateOnce()
})
</script>

<template>
  <div v-if="visible && update" class="update-backdrop">
    <section class="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-title">
      <header>
        <div>
          <p class="eyebrow">Update available</p>
          <h1 id="update-title">PRISM Worldgen Lab {{ update.version }}</h1>
        </div>
        <button
          class="icon-button"
          title="Close update prompt"
          :disabled="phase === 'downloading' || phase === 'installing' || phase === 'restarting'"
          @click="dismissUpdate"
        >
          <font-awesome-icon icon="fa-xmark" />
        </button>
      </header>

      <p class="summary">
        You are running {{ update.currentVersion }}. A newer signed GitHub release is ready to install.
      </p>

      <div v-if="update.body" class="release-notes">
        {{ update.body }}
      </div>

      <div v-if="phase === 'downloading'" class="progress-block">
        <div class="progress-label">
          <span>Downloading update</span>
          <span v-if="totalBytes">{{ formatBytes(downloadedBytes) }} / {{ formatBytes(totalBytes) }}</span>
          <span v-else>{{ formatBytes(downloadedBytes) }}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${downloadProgress}%` }"></div>
        </div>
      </div>

      <p v-else-if="phase === 'installing'" class="status-line">Installing update...</p>
      <p v-else-if="phase === 'restarting'" class="status-line">Restarting PRISM Worldgen Lab...</p>
      <p v-else-if="phase === 'error'" class="error-line">{{ errorMessage }}</p>

      <footer>
        <button
          class="secondary"
          :disabled="phase === 'downloading' || phase === 'installing' || phase === 'restarting'"
          @click="dismissUpdate"
        >
          Later
        </button>
        <button
          class="primary"
          :disabled="phase === 'downloading' || phase === 'installing' || phase === 'restarting'"
          @click="installUpdate"
        >
          Install and restart
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.update-backdrop {
  position: fixed;
  inset: 0;
  z-index: 7000;
  display: grid;
  place-items: center;
  background: rgba(0, 15, 18, 0.66);
}

.update-dialog {
  width: min(34rem, calc(100vw - 2rem));
  max-height: calc(100vh - 2rem);
  overflow: auto;
  border: 1px solid rgba(110, 245, 230, 0.38);
  border-radius: 8px;
  padding: 1.1rem;
  color: #e9ffff;
  background: #042c34;
  box-shadow: 0 1.25rem 3rem rgba(0, 0, 0, 0.45);
}

header,
footer,
.progress-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
}

.eyebrow {
  margin: 0 0 0.2rem;
  color: #72fff1;
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-size: 1.15rem;
}

.icon-button,
button {
  border: 0;
  border-radius: 6px;
  color: #efffff;
  background: #075a68;
  font-weight: 700;
  cursor: pointer;
}

.icon-button {
  width: 2rem;
  height: 2rem;
}

button {
  min-height: 2rem;
  padding: 0 0.9rem;
}

button:disabled {
  cursor: default;
  opacity: 0.55;
}

.primary {
  background: linear-gradient(135deg, #0aa9b7, #5de0c2);
  color: #021b20;
}

.secondary {
  background: rgba(255, 255, 255, 0.12);
}

.summary,
.status-line,
.error-line {
  margin: 0.9rem 0;
  line-height: 1.35;
}

.release-notes {
  max-height: 9rem;
  overflow: auto;
  margin: 0.9rem 0;
  padding: 0.7rem;
  border-radius: 6px;
  white-space: pre-wrap;
  background: rgba(255, 255, 255, 0.08);
}

.progress-block {
  margin: 1rem 0;
}

.progress-label {
  margin-bottom: 0.4rem;
  font-size: 0.82rem;
}

.progress-track {
  height: 0.55rem;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #50dfff, #86ffd3);
}

.error-line {
  color: #ffb4b4;
}
</style>
