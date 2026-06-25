<script setup lang="ts">
import { computed, ref } from 'vue';
import DatapackEntry from './DatapackEntry.vue';
import { useDatapackStore } from '../stores/useDatapackStore';

const store = useDatapackStore();
const visibleDatapacks = computed(() => store.datapacks.filter(datapack => datapack.removable))
const open = ref(false)

function clearLoadedPacks() {
    store.clearRemovableDatapacks()
    open.value = false
}
</script>

<template>
    <div v-if="visibleDatapacks.length > 0" class="datapack_section">
        <div class="datapack_header">
            <button class="toggle" type="button" @click="open = !open" :aria-expanded="open">
                <font-awesome-icon :icon="open ? 'fa-angle-down' : 'fa-angle-right'" />
                <span>Loaded resources</span>
                <strong>{{ visibleDatapacks.length }}</strong>
            </button>
            <button class="clear" type="button" title="Remove all loaded mods and packs" @click="clearLoadedPacks">
                <font-awesome-icon icon="fa-trash" />
            </button>
        </div>

        <div v-if="open" class="datapack_list">
            <Suspense>
                <DatapackEntry
                    v-for="datapack in visibleDatapacks"
                    :datapack="datapack.datapack"
                    :key="datapack.key"
                    :removable="datapack.removable ?? false"
                    :source-type="datapack.sourceType"
                    @close="store.removeDatapack(store.datapacks.indexOf(datapack))"
                />
            </Suspense>
        </div>

    </div>
</template>

<style scoped>
.datapack_section {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
}

.datapack_header {
    align-items: center;
    display: grid;
    gap: 0.45rem;
    grid-template-columns: minmax(0, 1fr) 2.25rem;
}

.toggle,
.clear {
    align-items: center;
    background: var(--prism-panel-2);
    border: 1px solid var(--prism-border-soft);
    color: white;
    cursor: pointer;
    display: flex;
    font: inherit;
    height: 2.25rem;
}

.toggle {
    border-radius: 0.45rem;
    gap: 0.55rem;
    justify-content: flex-start;
    min-width: 0;
    padding: 0 0.65rem;
}

.toggle span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.toggle strong {
    background: rgba(126, 230, 238, 0.18);
    border: 1px solid rgba(126, 230, 238, 0.28);
    border-radius: 999px;
    color: var(--prism-accent);
    font-size: 0.8rem;
    min-width: 1.7rem;
    padding: 0.08rem 0.35rem;
}

.clear {
    border-radius: 0.45rem;
    justify-content: center;
    padding: 0;
}

.toggle:hover,
.clear:hover {
    background: var(--prism-panel-3);
    border-color: var(--prism-accent-soft);
}

.datapack_list {
    display: flex;
    flex-direction: column-reverse;
    align-items: center;
    gap: 0.55rem;
}


</style>
