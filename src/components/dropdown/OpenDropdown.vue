<script setup lang="ts">
import { useDatapackStore } from '../../stores/useDatapackStore';
import { Datapack, UNKOWN_PACK } from 'mc-datapack-loader';
import DropdownIconEntry from './DropdownIconEntry.vue';
import DropdownRecentsEntry from './DropdownRecentsEntry.vue';
import Dropdown from './Dropdown.vue';
import { computed, onMounted, ref } from 'vue';
import { useRecentStore, StoredDatapack } from '../../stores/useRecentStore';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { versionMetadata } from '../../util';
import { EventTracker } from '../../util/EventTracker';
import { useUiStore } from '../../stores/useUiStore';
import Popup from '../Popup.vue';
import ModrinthMenu from '../modrinth/ModrinthMenu.vue';

type Preset = {id: string, image: string, message_key: string, url: string }

const i18n = useI18n()

const settingsStore = useSettingsStore()
const datapackStore = useDatapackStore();
const recentStore = useRecentStore();
const uiStore = useUiStore();
const emit = defineEmits(['close'])

const disabledRecents = ref<string[]>([])
const errorMessage = ref<string | undefined>()

const modrinthPopup = ref<any>(null)
const publicJarRecents = computed(() => recentStore.recents.filter(recent =>
    recent.modrinthSlug !== undefined
    || (recent.fileHandle?.kind === "file" && recent.fileHandle.name.toLowerCase().endsWith(".jar"))
))

async function loadRecent(recent: StoredDatapack) {
    if (recent.modrinthSlug !== undefined) {
        try {
            const datapack = await datapackStore.addModrinthDatapack(recent.modrinthSlug)

            recentStore.addRecentModrinth(datapack, recent.modrinthSlug, recent.text)
            EventTracker.track(`add_datapack/modrinth/from_recent`)
            EventTracker.track(`add_datapack/modrinth/${recent.modrinthSlug}`)
        } catch {
            disabledRecents.value.push(recent.modrinthSlug)
            return
        }
    } else if (recent.fileHandle !== undefined){
        const handle = recent.fileHandle
        if ('requestPermission' in handle){
            const permission = await handle.requestPermission({mode: 'read'})
            if (permission !== "granted"){
                emit('close')
                return;
            }
        }

        var datapack = undefined
        try {
            if (handle.kind === 'file') {
                const file = await (handle as FileSystemFileHandle).getFile()
                datapack = Datapack.fromZipFile(file, versionMetadata[settingsStore.mc_version].datapackFormat)
                // if old version stored local file system handle, store it in opfs now
                if (!recent.storedInOpfs){
                    EventTracker.track(`add_datapack/zip/from_recent/upgraded`)
                    recentStore.storeAndAddRecent(file, datapack)
                } else {
                    EventTracker.track(`add_datapack/zip/from_recent`)
                    recentStore.addRecentFileHandle(handle, datapack)
                }
            } else {
                datapack = Datapack.fromFileSystemDirectoryHandle(handle as FileSystemDirectoryHandle, versionMetadata[settingsStore.mc_version].datapackFormat)
                recentStore.addRecentFileHandle(handle, datapack)
                EventTracker.track(`add_datapack/folder/from_recent`)
            }
            datapackStore.addDatapack(datapack)
        } catch (e){
            if (e instanceof DOMException){
                if (recent.storedInOpfs){
                    EventTracker.track(`add_datapack/removed_from_recent/opfs`)
                } else {
                    EventTracker.track(`add_datapack/removed_from_recent/local`)
                }
                recentStore.removeRecentFileHandle(handle.name)
                errorMessage.value = i18n.t('dropdown.add.recents.not_found')
                return
            }
        }
    }

    emit('close')
}

async function loadPreset(preset: Preset) {
    EventTracker.track(`add_datapack/built_in/${preset.id}`)
    const datapack = Datapack.fromZipUrl(preset.url, versionMetadata[settingsStore.mc_version].datapackFormat)
    datapackStore.addDatapack(datapack)
    emit('close')
}


async function loadZip(event: MouseEvent) {
    async function addZipDatapack(file: File) {
        if (!file.name.toLowerCase().endsWith(".jar")) {
            return undefined;
        }
        EventTracker.track(`add_datapack/jar`)
        const datapack = Datapack.fromZipFile(file, versionMetadata[settingsStore.mc_version].datapackFormat)
        datapackStore.addDatapack(datapack)
        return datapack
    }

    if ("showOpenFilePicker" in window) {
        let fileHandle
        try {
            [fileHandle] = await window.showOpenFilePicker({
                types: [
                    {
                        description: "Minecraft mod jar",
                        accept: {
                            "application/java-archive": [".jar"]
                        }
                    }
                ]
            })
        } catch (e) {
        } finally {
            if (fileHandle !== undefined) {
                const file = await fileHandle.getFile()
                const datapack = await addZipDatapack(file)
                if (datapack) {
                    recentStore.storeAndAddRecent(file, datapack)
                }
            }
        }
    } else {
        const input = document.createElement('input') as HTMLInputElement
        input.type = 'file'
        input.accept = '.jar'

        input.onchange = async (evt) => {
            const file = (evt.target as HTMLInputElement).files![0]
            const datapack = await addZipDatapack(file)
            if (datapack) {
                recentStore.storeAndAddRecent(file, datapack)
            }
        }

        input.click()
    }
    emit('close')
}

async function loadFolder(event: MouseEvent) {
    var datapack: Datapack | undefined = undefined

    if ("showDirectoryPicker" in window) {
        try {
            const handle = await window.showDirectoryPicker()
            datapack = Datapack.fromFileSystemDirectoryHandle(handle, versionMetadata[settingsStore.mc_version].datapackFormat)
            recentStore.addRecentFileHandle(handle, datapack)
        } catch (e) {
        }
    } else {
        datapack = await new Promise<Datapack>((resolve) => {
            const input: any = document.createElement('input')
            input.type = 'file'
            input.webkitdirectory = true

            input.onchange = async () => {
                resolve(Datapack.fromFileList(Array.from(input.files), versionMetadata[settingsStore.mc_version].datapackFormat))
            }
            input.click()
        })
    }

    if (datapack !== undefined) {
        EventTracker.track(`add_datapack/folder`)
        datapackStore.addDatapack(datapack)
    }
    emit('close')
}

function isPackArchive(fileName: string) {
    return fileName.toLowerCase().endsWith(".jar") || fileName.toLowerCase().endsWith(".zip")
}

async function loadInstanceModsFolder(event: MouseEvent) {
    const modFiles: File[] = []

    if ("showDirectoryPicker" in window) {
        try {
            const handle = await window.showDirectoryPicker()
            for await (const entry of (handle as any).values()) {
                if (entry.kind !== "file" || !isPackArchive(entry.name)) continue
                modFiles.push(await entry.getFile())
            }
        } catch (e) {
        }
    } else {
        await new Promise<void>((resolve) => {
            const input: any = document.createElement('input')
            input.type = 'file'
            input.webkitdirectory = true

            input.onchange = async () => {
                modFiles.push(...Array.from(input.files as FileList).filter(file => isPackArchive(file.name)))
                resolve()
            }
            input.click()
        })
    }

    modFiles.sort((a, b) => a.name.localeCompare(b.name))

    if (modFiles.length === 0) {
        errorMessage.value = "No .jar files found in the selected folder."
        emit('close')
        return
    }

    EventTracker.track(`add_datapack/instance_mod_folder`)
    const datapacks = modFiles.map(file => Datapack.fromZipFile(file, versionMetadata[settingsStore.mc_version].datapackFormat))
    datapackStore.addInstanceModDatapacks(datapacks)
    emit('close')
}

function openModrinth() {
    modrinthPopup.value.show()
    uiStore.modrinthMenuOpen = true
}

const PRESET_DATAPACKS = computed(() => {
    const presets: Preset[] = []
    versionMetadata[settingsStore.mc_version].experimentalDatapacks.forEach(ed => {
        presets.push({id: ed.url, image: UNKOWN_PACK, message_key: ed.translation_key, url: `vanilla_datapacks/vanilla_${ed.url}.zip`})
    })

    return presets
})

</script>

<template>
    <Dropdown>
        <div class="status" v-if="errorMessage">{{ errorMessage }}</div>
        <DropdownIconEntry icon="fa-file-zipper" @click="loadZip" @keypress.enter="loadZip">Load mod jar</DropdownIconEntry>
        <DropdownIconEntry image="/images/modrinth.svg" @click="openModrinth" @keypress.enter="openModrinth">{{ i18n.t('dropdown.add.modrinth') }}</DropdownIconEntry>
        <div class="spacer" v-if="PRESET_DATAPACKS.length > 0"></div>
        <div class="title" v-if="PRESET_DATAPACKS.length > 0">{{ i18n.t('dropdown.add.built_in.title') }} </div>
        <DropdownRecentsEntry v-for="preset in PRESET_DATAPACKS" :image="preset.image" @click="loadPreset(preset);"
            @keypress.enter="loadPreset(preset)">{{ i18n.t(preset.message_key) }}</DropdownRecentsEntry>
        <div class="spacer"></div>
        <div class="title">{{ i18n.t('dropdown.add.recents.title') }}</div>
        <div class="enable" v-if="recentStore.avalible && !recentStore.enabled" @click="recentStore.enable()"
            @keypress.enter="recentStore.enable()" tabindex="0">
            {{ i18n.t('dropdown.add.recents.enable') }}
            <div class="note">{{ i18n.t('dropdown.add.recents.enable.note') }}</div>
        </div>
        <div class="empty" v-if="recentStore.avalible && recentStore.enabled && publicJarRecents.length === 0">--- {{
            i18n.t('dropdown.add.recents.empty') }} ---</div>
        <div class="empty small" v-if="!recentStore.avalible">{{ i18n.t('dropdown.add.recents.unavailable') }}</div>
        <DropdownRecentsEntry v-for="recent in publicJarRecents" :image="recent.img" :title="recent.fileHandle?.name ?? recent.modrinthSlug" :type="recent.modrinthSlug ? 'modrinth' : recent.fileHandle?.kind"
            @click="loadRecent(recent)" @keypress.enter="loadRecent(recent)" :disabled="recent.modrinthSlug !== undefined && disabledRecents.includes(recent.modrinthSlug)"> {{ recent.text }} </DropdownRecentsEntry>
    </Dropdown>
    <Popup ref="modrinthPopup" :title="i18n.t('modrinth.title')">
        <template #default="{ close }">
            <ModrinthMenu @close="close(); emit('close')" />
        </template>
    </Popup>
</template>

<style scoped>
.spacer {
    width: 100%;
    height: 2px;
    min-height: 2px;
    background-color: rgb(97, 97, 97);
    align-self: center;
    margin-top: 0.2rem;
    margin-bottom: 0rem;
}

.title {
    color: rgb(53, 53, 53);
    text-align: initial;
    width: 100%;
    box-sizing: border-box;
    margin-top: 0;
    font-size: smaller;
    padding-inline-start: 1rem;
    margin-bottom: 0.2rem;
}

.status {
    width: 100%;
    box-sizing: border-box;
    padding: 0.35rem 0.45rem;
    border-radius: 0.25rem;
    background: rgba(15, 110, 125, 0.18);
    color: rgb(25, 55, 62);
    font-size: 0.75rem;
    line-height: 1.25;
}

.enable {
    background-color: rgb(132, 171, 216);
    padding: 0.5rem;
    border-radius: 0.5rem;
    cursor: pointer;
    width: calc(100% - 2rem);
    text-align: center;
}

.enable .note {
    font-size: smaller;
}

.enable:hover {
    background-color: rgb(178, 200, 226);
}

.empty {
    color: rgb(78, 78, 78);
}

.small {
    font-size: smaller;
}
</style>
