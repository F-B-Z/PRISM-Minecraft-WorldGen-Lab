<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useDatapackStore } from '../stores/useDatapackStore';
import { useMdfModeStore } from '../stores/useMdfModeStore';
import { usePrismTuningStore, PrismTuningResource } from '../stores/usePrismTuningStore';

const tuningStore = usePrismTuningStore();
const datapackStore = useDatapackStore();
const mdfModeStore = useMdfModeStore();
let unsubscribeDatapacks: (() => void) | undefined;
const presetImportInput = ref<HTMLInputElement | undefined>();
const importStatus = ref<string | undefined>();
const savePresetOpen = ref(false);
const customPresetName = ref("Custom worldgen preset");
const customPresetGroup = ref("Custom");
const tuningKinds = ["density_function", "noise"] as const;

const openGroups = ref<Record<string, boolean>>({
    lithosphere: true,
    'lithosphere/noise': true,
    'lithosphere/density_function': false,
    still_life: true,
    'still_life/density_function': false
});

const activeSettings = computed(() => tuningStore.loaded?.settings ?? []);

function toggle(key: string) {
    openGroups.value[key] = !openGroups.value[key];
}

function groupOpen(key: string) {
    return openGroups.value[key] ?? false;
}

function selectResource(resource: PrismTuningResource) {
    tuningStore.loadResource(resource);
}

function isSelected(resource: PrismTuningResource) {
    return tuningStore.selectedId === `${resource.kind}:${resource.id}`;
}

function isChanged(resource: PrismTuningResource) {
    return tuningStore.isResourceChanged(resource);
}

function formatKind(kind: string) {
    return kind === 'density_function' ? 'density_function' : kind;
}

function choosePresetImport() {
    presetImportInput.value?.click();
}

async function importPresets(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
        const result = await tuningStore.importPresetsFromFile(file);
        importStatus.value = `Loaded ${result.presets} presets in ${result.groups} groups.`;
    } catch (e) {
        importStatus.value = `Preset import failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
        input.value = "";
    }
}

async function importPresetDrop(event: DragEvent) {
    const file = event.dataTransfer?.files?.[0];
    if (!file || !file.name.endsWith(".json")) return;
    try {
        const result = await tuningStore.importPresetsFromFile(file);
        importStatus.value = `Loaded ${result.presets} presets in ${result.groups} groups.`;
    } catch (e) {
        importStatus.value = `Preset import failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}

async function selectGroupPreset(group: string, event: Event) {
    const presetId = (event.target as HTMLSelectElement).value;
    if (group === "Themes" && presetId && tuningStore.hasActiveNonThemePresets) {
        importStatus.value = "Theme warning: themes are broad experimental combinations and are not tested together with other preset categories. You can continue, but verify carefully.";
    }
    await tuningStore.selectPresetForGroup(group, presetId);
}

function openHelp() {
    window.dispatchEvent(new Event('prism-worldgen-lab-help'));
}

function toggleSavePreset() {
    savePresetOpen.value = !savePresetOpen.value;
}

function saveCurrentPreset() {
    try {
        tuningStore.exportCurrentTuningAsPreset(customPresetName.value.trim() || "Custom worldgen preset", customPresetGroup.value.trim() || "Custom");
        savePresetOpen.value = false;
    } catch (e) {
        importStatus.value = e instanceof Error ? e.message : String(e);
    }
}

onMounted(() => {
    tuningStore.loadBundledAnnotations().then(result => {
        importStatus.value = `Loaded ${result.resources} function labels and ${result.settings} setting labels.`;
    }).catch(e => {
        importStatus.value = `Bundled labels failed: ${e instanceof Error ? e.message : String(e)}`;
    });
    try {
        tuningStore.loadBundledPresets().catch(e => {
            importStatus.value = `Bundled presets failed: ${e instanceof Error ? e.message : String(e)}`;
        });
    } catch (e) {
        importStatus.value = `Bundled presets failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    tuningStore.refreshResources();
    unsubscribeDatapacks = datapackStore.onTuningChanged(() => {
        tuningStore.refreshResources();
    });
});

onBeforeUnmount(() => unsubscribeDatapacks?.());
</script>

<template>
    <section class="prism-tuning-panel" @dragover.prevent @drop.prevent="importPresetDrop">
        <div class="panel-header">
            <div>
                <h2>PRISM Lab</h2>
                <span>{{ activeSettings.length }} settings - {{ tuningStore.namedResourceCount + tuningStore.namedSettingCount }} labels</span>
            </div>
            <div class="header-actions">
                <input
                    ref="presetImportInput"
                    class="hidden-file-input"
                    type="file"
                    accept="application/json,.json"
                    @change="importPresets"
                />
                <button class="icon-button" title="Load worldgen preset pack" @click="choosePresetImport">
                    <font-awesome-icon icon="fa-folder-open" />
                </button>
                <button class="icon-button action-export" title="Export current tuning as datapack zip" @click="tuningStore.exportDatapack">
                    <font-awesome-icon icon="fa-file-zipper" />
                </button>
                <button class="icon-button action-preset" title="Save current tuning as a reusable preset pack" @click="toggleSavePreset">
                    <font-awesome-icon icon="fa-file-export" />
                </button>
                <button class="icon-button" title="Reload PRISM worldgen resources" @click="tuningStore.refreshResources">
                    <font-awesome-icon icon="fa-rotate-right" />
                </button>
                <button class="icon-button" title="Show PRISM Lab help" @click="openHelp">
                    <font-awesome-icon icon="fa-circle-question" />
                </button>
            </div>
        </div>
        <div v-if="importStatus" class="status">{{ importStatus }}</div>

        <div v-if="savePresetOpen" class="save-preset-panel">
            <label>
                <span>Preset name</span>
                <input v-model="customPresetName" type="text" />
            </label>
            <label>
                <span>Group</span>
                <input v-model="customPresetGroup" type="text" />
            </label>
            <div class="save-preset-actions">
                <button type="button" @click="savePresetOpen = false">Cancel</button>
                <button type="button" class="primary" @click="saveCurrentPreset">Export preset</button>
            </div>
        </div>

        <div class="preset-panel" v-if="tuningStore.presets.length">
            <div class="preset-title">
                <strong>Preset Mixer</strong>
                <span>{{ tuningStore.presets.length }} loaded</span>
            </div>
            <div class="preset-mixer">
                <label v-for="group in tuningStore.groupedPresets" :key="group.group" class="preset-group-row">
                    <span>{{ group.group }}</span>
                    <select :value="group.activePresetId" @change="selectGroupPreset(group.group, $event)" :title="group.activePreset?.description ?? `Choose ${group.group} preset`">
                        <option value="">Default</option>
                        <option v-for="preset in group.presets" :key="preset.id" :value="preset.id">
                            {{ preset.name }}
                        </option>
                    </select>
                    <small v-if="group.activePreset" :title="group.activePreset.description">
                        {{ group.activePreset.description }}
                    </small>
                </label>
            </div>
            <div class="preset-controls">
                <span>{{ tuningStore.activePresets.length }} active group{{ tuningStore.activePresets.length === 1 ? '' : 's' }}</span>
                <button title="Reset preset-touched values to default" @click="tuningStore.resetPresetDefaults">
                    Reset all
                </button>
            </div>
            <div v-if="tuningStore.presetStatus" class="status">{{ tuningStore.presetStatus }}</div>
            <details v-if="tuningStore.presetWarnings.length" class="preset-warnings">
                <summary>{{ tuningStore.presetWarnings.length }} preset warning{{ tuningStore.presetWarnings.length === 1 ? '' : 's' }}</summary>
                <ul>
                    <li v-for="warning in tuningStore.presetWarnings" :key="warning">{{ warning }}</li>
                </ul>
            </details>
        </div>

        <label class="mdf-mode-toggle" title="Switch the editor and preview parser to More Density Functions compatibility mode.">
            <input v-model="mdfModeStore.enabled" type="checkbox" />
            <span>MDF Mode {{ mdfModeStore.enabled ? '[x]' : '[ ]' }}</span>
        </label>
        <div v-if="mdfModeStore.enabled" class="mdf-mode-note">
            More Density Functions compatibility is active. Core math and coordinate functions are interpreted; complex MDF noise/image functions are approximate or fall back to zero until implemented.
        </div>

        <div class="tree">
            <template v-for="category in tuningStore.tree" :key="category.id">
                <button class="tree-row root" @click="toggle(category.id)">
                    <span>{{ groupOpen(category.id) ? 'v' : '>' }}</span>
                    <strong>{{ category.title }}</strong>
                </button>
                <div v-if="groupOpen(category.id)" class="tree-children">
                    <template v-for="kind in tuningKinds" :key="`${category.id}/${kind}`">
                        <template v-if="category.kinds[kind].length">
                            <button class="tree-row branch" @click="toggle(`${category.id}/${kind}`)">
                                <span>{{ groupOpen(`${category.id}/${kind}`) ? 'v' : '>' }}</span>
                                {{ formatKind(kind) }}
                                <em>{{ category.kinds[kind].length }}</em>
                            </button>
                            <div v-if="groupOpen(`${category.id}/${kind}`)" class="tree-children">
                                <template v-for="resource in category.kinds[kind]" :key="resource.id">
                                    <button
                                        class="tree-row leaf"
                                        :class="{ active: isSelected(resource), changed: isChanged(resource) }"
                                        @click="selectResource(resource)"
                                    >
                                        <span class="changed-dot" v-if="isChanged(resource)">*</span>
                                        {{ tuningStore.getResourceDisplayName(resource) }}
                                    </button>
                                    <div v-if="isSelected(resource) && tuningStore.loaded" class="inline-editor">
                                        <div class="editor-title">
                                            <div>
                                                <strong>{{ tuningStore.getResourceDisplayName(tuningStore.loaded.resource) }}</strong>
                                                <small>{{ tuningStore.loaded.resource.id }}</small>
                                            </div>
                                            <button title="Reset selected resource" @click="tuningStore.resetLoadedResource">
                                                Reset
                                            </button>
                                        </div>
                                        <div class="settings-list">
                                            <label v-for="setting in activeSettings" :key="setting.key" class="setting-row" :class="{ changed: tuningStore.isSettingChanged(setting) }">
                                                <span class="setting-label" :title="setting.label">
                                                    <span class="changed-dot" v-if="tuningStore.isSettingChanged(setting)">*</span>{{ tuningStore.getSettingDisplayLabel(setting) }}
                                                </span>
                                                <div class="setting-controls">
                                                    <input
                                                        type="range"
                                                        :min="setting.min"
                                                        :max="setting.max"
                                                        :step="setting.step"
                                                        :value="setting.value"
                                                        @input="tuningStore.applyNumber(setting, ($event.target as HTMLInputElement).value)"
                                                    />
                                                    <input
                                                        type="number"
                                                        :step="setting.step"
                                                        :value="setting.value"
                                                        @change="tuningStore.applyNumber(setting, ($event.target as HTMLInputElement).value)"
                                                    />
                                                </div>
                                            </label>
                                        </div>
                                    </div>
                                </template>
                            </div>
                        </template>
                    </template>
                </div>
            </template>
        </div>

        <div v-if="tuningStore.loading" class="status">Loading resource...</div>
        <div v-else-if="tuningStore.error" class="status error">{{ tuningStore.error }}</div>

        <div v-if="!tuningStore.loaded" class="empty">
            Select a noise or density function to expose numeric controls.
        </div>
    </section>
</template>

<style scoped>
.prism-tuning-panel {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    color: white;
    font-size: 0.78rem;
}

.panel-header,
.editor-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
}

.header-actions {
    display: flex;
    align-items: center;
    gap: 0.35rem;
}

.hidden-file-input {
    display: none;
}

h2 {
    margin: 0;
    font-size: 1rem;
    line-height: 1.2;
}

.panel-header span,
small,
em {
    color: var(--prism-muted);
    font-style: normal;
}

.icon-button,
.editor-title button {
    border: 0;
    background: var(--prism-panel-3);
    color: var(--prism-text);
    cursor: pointer;
    min-width: 1.9rem;
    min-height: 1.9rem;
    border-radius: 0.35rem;
}

.icon-button:hover,
.editor-title button:hover {
    background: var(--prism-border);
}

.icon-button.action-export {
    background: linear-gradient(180deg, #2abdc9, #0d7e91);
    color: rgb(2, 17, 22);
}

.icon-button.action-preset {
    background: linear-gradient(180deg, #80e5c9, #239a8e);
    color: rgb(2, 17, 22);
}

.icon-button.action-export:hover,
.icon-button.action-preset:hover {
    filter: brightness(1.12);
}

.tree {
    display: flex;
    flex-direction: column;
    gap: 0.12rem;
}

.tree-children {
    display: flex;
    flex-direction: column;
    margin-left: 0.7rem;
    border-left: 1px solid var(--prism-border-soft);
    padding-left: 0.45rem;
}

.tree-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-height: 1.45rem;
    border: 0;
    border-radius: 0.25rem;
    color: var(--prism-text);
    background: transparent;
    text-align: left;
    cursor: pointer;
    padding: 0.15rem 0.25rem;
    font: inherit;
}

.tree-row span {
    width: 0.7rem;
    color: var(--prism-accent-2);
}

.tree-row em {
    margin-left: auto;
    font-size: 0.68rem;
}

.tree-row:hover {
    background: rgba(54, 214, 230, 0.12);
}

.tree-row.active {
    background: rgba(54, 214, 230, 0.28);
}

.tree-row.changed {
    box-shadow: inset 0.18rem 0 0 var(--prism-active);
    background: rgba(114, 215, 200, 0.13);
}

.leaf {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.changed-dot {
    width: auto !important;
    flex: 0 0 auto;
    color: var(--prism-active) !important;
    font-weight: 700;
}

.status,
.empty {
    color: var(--prism-muted);
    line-height: 1.35;
}

.error {
    color: rgb(255, 178, 178);
}

.preset-panel {
    display: flex;
    flex-direction: column;
    gap: 0.42rem;
    padding: 0.55rem;
    border: 1px solid var(--prism-border-soft);
    border-radius: 0.35rem;
    background: rgba(5, 27, 34, 0.48);
}

.save-preset-panel {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    padding: 0.55rem;
    border: 1px solid var(--prism-border-soft);
    border-radius: 0.35rem;
    background: rgba(5, 27, 34, 0.58);
}

.save-preset-panel label {
    display: grid;
    grid-template-columns: 5.6rem minmax(0, 1fr);
    gap: 0.45rem;
    align-items: center;
    color: var(--prism-muted);
}

.save-preset-panel input {
    min-width: 0;
    box-sizing: border-box;
    border: 1px solid var(--prism-border);
    background: var(--prism-field);
    color: black;
    border-radius: 0.25rem;
    min-height: 1.55rem;
    padding: 0 0.35rem;
    font-size: 0.72rem;
}

.save-preset-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
}

.save-preset-actions button {
    border: 1px solid var(--prism-border-soft);
    background: var(--prism-panel-3);
    color: var(--prism-text);
    border-radius: 0.3rem;
    min-height: 1.65rem;
    padding: 0 0.55rem;
}

.save-preset-actions .primary {
    background: var(--prism-accent);
    color: rgb(2, 17, 22);
}

.preset-title,
.preset-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
}

.preset-mixer {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 16rem;
    overflow-y: auto;
    padding-right: 0.1rem;
}

.preset-group-row {
    display: grid;
    grid-template-columns: 4.9rem minmax(0, 1fr);
    gap: 0.18rem 0.35rem;
    align-items: center;
}

.preset-group-row > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--prism-text);
}

.preset-group-row small {
    grid-column: 2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.preset-title span,
.preset-description {
    color: var(--prism-muted);
}

.preset-group-row select {
    min-width: 0;
    width: 100%;
    border: 1px solid var(--prism-border);
    background: var(--prism-field);
    color: black;
    border-radius: 0.25rem;
    min-height: 1.55rem;
    font-size: 0.72rem;
}

.preset-controls button {
    border: 0;
    background: var(--prism-panel-3);
    color: var(--prism-text);
    cursor: pointer;
    min-height: 1.55rem;
    border-radius: 0.25rem;
    padding: 0 0.5rem;
}

.preset-controls button:hover {
    background: var(--prism-border);
}

.preset-description {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.preset-warnings {
    color: rgb(255, 218, 153);
}

.preset-warnings ul {
    margin: 0.35rem 0 0;
    padding-left: 1rem;
}

.mdf-mode-toggle {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 1.85rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid rgba(54, 214, 230, 0.38);
    border-radius: 0.35rem;
    background: rgba(5, 57, 67, 0.66);
    color: var(--prism-text);
    cursor: pointer;
    font-weight: 700;
}

.mdf-mode-toggle input {
    accent-color: var(--prism-accent);
}

.mdf-mode-note {
    margin-top: -0.35rem;
    color: var(--prism-muted);
    line-height: 1.3;
}

.inline-editor {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    margin: 0.2rem 0 0.5rem 0.25rem;
    padding: 0.65rem 0.5rem;
    border-left: 0.18rem solid var(--prism-accent);
    background: rgba(5, 27, 34, 0.42);
    border-radius: 0.25rem;
}

.editor-title > div {
    min-width: 0;
}

.editor-title strong,
.editor-title small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.settings-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: 27rem;
    overflow-y: auto;
    padding-right: 0.15rem;
}

.setting-row {
    display: grid;
    grid-template-columns: minmax(6.5rem, 1fr) 5.8rem 4.2rem;
    gap: 0.3rem 0.35rem;
    align-items: center;
    padding-bottom: 0.35rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.setting-row.changed {
    background: rgba(114, 215, 200, 0.12);
    border-radius: 0.25rem;
    padding-left: 0.25rem;
    padding-right: 0.25rem;
}

.setting-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--prism-text);
}

.setting-controls {
    display: contents;
}

.setting-row input[type="range"] {
    width: 100%;
}

.setting-row input[type="number"] {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    background: var(--prism-field);
    color: rgb(16, 25, 31);
    border: 0;
    border-radius: 0.25rem;
    padding: 0.18rem;
    font-size: 0.72rem;
}

</style>
