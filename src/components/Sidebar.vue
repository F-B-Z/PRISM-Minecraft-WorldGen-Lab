<script setup lang="ts">
import { Datapack } from 'mc-datapack-loader';
import { ref } from 'vue';
import { useDatapackStore } from '../stores/useDatapackStore';
import { useRecentStore } from '../stores/useRecentStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { versionMetadata } from '../util';
import DatapackSelection from './DatapackList.vue';
import Footer from './Footer.vue';
import MenuButtons from './MenuButtons.vue';
import SettingsPanel from './SettingsPanel.vue';
import { EventTracker } from '../util/EventTracker';
import PrismTuningPanel from './PrismTuningPanel.vue';

    const datapackStore = useDatapackStore()
    const settingsStore = useSettingsStore()
    const recentStore = useRecentStore();

    const file_dragging = ref(false)
    async function dropHandler(ev: DragEvent){

        if (ev.dataTransfer === null){
            return
        }
        ev.preventDefault()
        file_dragging.value = false

        const datapackVersion = versionMetadata[settingsStore.mc_version].datapackFormat

        for (const item of ev.dataTransfer.items){
            if ("getAsFileSystemHandle" in item){
                const handle = await item.getAsFileSystemHandle()
                var datapack: Datapack
                if (handle instanceof FileSystemDirectoryHandle){
                    EventTracker.track(`add_datapack/folder/drag_and_drop`)
                    datapack = Datapack.fromFileSystemDirectoryHandle(handle, datapackVersion)
                    datapackStore.addDatapack(datapack)
                    recentStore.addRecentFileHandle(handle, datapack)
                } else if (handle instanceof FileSystemFileHandle) {
                    EventTracker.track(`add_datapack/zip/drag_and_drop`)
                    const file = await handle.getFile()
                    datapack = Datapack.fromZipFile(file, datapackVersion)
                    datapackStore.addDatapack(datapack)
                    recentStore.storeAndAddRecent(file, datapack)
                }
            } else {
                if (["application/zip", 'application/java-archive', 'application/x-java-archive'].includes((item as DataTransferItem).type)){
                    const file = (item as DataTransferItem).getAsFile()
                    if (file){
                        EventTracker.track(`add_datapack/zip/drag_and_drop`)
                        const datapack = Datapack.fromZipFile(file, datapackVersion)
                        datapackStore.addDatapack(datapack)
                        recentStore.storeAndAddRecent(file, datapack)
                    }
                }
            }
        }
    }

    function dragOverHandler(ev: DragEvent){

        ev.preventDefault()
    }


</script>

<template>
    <div class="sidebar"
        @drop="dropHandler"
        @dragover="dragOverHandler"
        @dragenter="file_dragging=true"
        @dragleave="file_dragging=false"
        :class="{file_dragging: file_dragging}"
    >
        <MenuButtons />
        <Suspense>
            <SettingsPanel />
        </Suspense>
        <PrismTuningPanel />
        <DatapackSelection />
        <Footer @open_popup="$emit('open_popup')" />
    </div>
</template>

<style scoped>
    .sidebar {
        height: 100%;
        min-width: var(--sidebar-width, 26rem);
        max-width: var(--sidebar-width, 26rem);
        display: flex;
        flex-direction: column;

        background:
            linear-gradient(180deg, rgba(54, 214, 230, 0.08), transparent 18rem),
            var(--prism-panel);
        color: white;
        
        overflow-y: scroll;
        padding: 1rem;
        padding-top: 1rem;
        gap: 1rem;
        box-sizing: border-box;

        transition: 0.3s;
    }

    .sidebar.file_dragging {
        background-color: var(--prism-panel-3);
    }

    .sidebar::-webkit-scrollbar {
        width: 0;
    }

</style>
