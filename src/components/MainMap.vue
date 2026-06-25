<script setup lang="ts">
import "leaflet/dist/leaflet.css";
import L, { control } from "leaflet";
import { BiomeLayer, type CaveViewMode, type DifferenceFilterMode, type DifferenceStats } from "../MapLayers/BiomeLayer";
import { Graticule } from "../MapLayers/Graticule";
import { nextTick, onMounted, ref, watch, watchEffect } from 'vue';
import BiomeTooltip from './BiomeTooltip.vue';
import { BlockPos, Chunk, ChunkPos, Climate, DensityFunction, Holder, Identifier, RandomState, Structure, StructurePlacement, StructureSet, WorldgenRegistries, WorldgenStructure } from 'deepslate';
import YSlider from './YSlider.vue';
import { useSearchStore } from '../stores/useBiomeSearchStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useLoadedDimensionStore } from '../stores/useLoadedDimensionStore'
import { useDatapackStore } from '../stores/useDatapackStore';
import { CachedBiomeSource } from '../util/CachedBiomeSource';
import MapButton from './MapButton.vue';
import { SpawnTarget } from '../util/SpawnTarget';
import { useI18n } from 'vue-i18n';
import { getCustomDensityFunction, versionMetadata } from "../util";

const searchStore = useSearchStore()
const settingsStore = useSettingsStore()
const loadedDimensionStore = useLoadedDimensionStore()
const datapackStore = useDatapackStore()
const i18n = useI18n()

let biomeLayer: BiomeLayer
let graticule: Graticule

const tooltip_left = ref(0)
const tooltip_top = ref(0)
const tooltip_biome = ref(Identifier.create("void"))
const tooltip_position = ref(BlockPos.ZERO)
const show_tooltip = ref(false)
const show_info = ref(false)

const do_hillshade = ref(true)
const show_sealevel = ref(false)
const show_heightmap = ref(false)
const project_down = ref(true)
const surface_biomes = ref(true)
const hillshade_strength = ref(1)
const cave_view = ref<CaveViewMode>("off")

const y = ref(320)

const show_graticule = ref(false)
const show_compare = ref(false)
const show_compare_difference = ref(false)
const compare_difference_filter = ref<DifferenceFilterMode>("all")
const show_clip_warning = ref(false)
const compare_difference_stats = ref<DifferenceStats>({ total: 0, changed: 0, changedPercent: 0, maxDelta: 0, averageDelta: 0, clipCount: 0 })
const show_reset_to_player = ref(false)

watch(show_graticule, (value) => {
    if (value) {
        map.addLayer(graticule)
    } else {
        map.removeLayer(graticule)
    }
})

var map: L.Map
var compareMap: L.Map | undefined
var zoom: L.Control.Zoom
var markers: L.LayerGroup
var spawnMarker: L.Marker
let compareBiomeLayer: BiomeLayer | undefined
let syncingMaps = false
let lastLevelHeightKey: string | undefined
let tooltipSurfaceDensityFunction: DensityFunction | undefined
let compareDifferenceRefreshTimeout: number | undefined
let compareDifferenceUnsubscribe: (() => boolean) | undefined
let compareStatsUnsubscribe: (() => boolean) | undefined

var marker_map = new Map<string, { marker?: L.Marker, structure?: {id: Identifier, pos: BlockPos}}>()
var needs_zoom = ref(false)

function refreshTooltipSurfaceDensityFunction() {
    const surfaceDensityFunctionId = getCustomDensityFunction("snowcapped_surface", loadedDimensionStore.loaded_dimension.noise_settings_id ?? Identifier.create("empty"), settingsStore.dimension)
    if (surfaceDensityFunctionId === undefined) {
        tooltipSurfaceDensityFunction = undefined
        return
    }

    const noiseGeneratorSettings = loadedDimensionStore.noise_generator_settings
    const randomState = new RandomState(noiseGeneratorSettings, settingsStore.seed)
    tooltipSurfaceDensityFunction = new DensityFunction.HolderHolder(
        Holder.reference(WorldgenRegistries.DENSITY_FUNCTION, surfaceDensityFunctionId)
    ).mapAll(randomState.createVisitor(noiseGeneratorSettings.noise, noiseGeneratorSettings.legacyRandomSource))
}

function getSurfaceClimateSampler(): Climate.Sampler {
    const sampler = loadedDimensionStore.sampler
    return {
        sample(x: number, y: number, z: number) {
            const climate = sampler.sample(x, y, z)
            return Climate.target(climate.temperature, climate.humidity, climate.continentalness, climate.erosion, 0, climate.weirdness)
        }
    } as Climate.Sampler
}

function updateTooltip(sourceMap: L.Map, evt: L.LeafletMouseEvent) {
    tooltip_left.value = evt.originalEvent.pageX-4
    tooltip_top.value = evt.originalEvent.pageY-4

    const pos = getPosition(sourceMap, evt.latlng)
    const biomeSampler = cave_view.value === "off" && project_down.value && surface_biomes.value ? getSurfaceClimateSampler() : loadedDimensionStore.sampler
    const biome = loadedDimensionStore.getBiomeSource()?.getBiome(pos[0] >> 2, pos[1] >> 2, pos[2] >> 2, biomeSampler) ?? Identifier.create("plains")

    tooltip_biome.value = biome
    tooltip_position.value = pos
    show_tooltip.value = true
}

onMounted(() => {
    refreshTooltipSurfaceDensityFunction()

    map = L.map("map", {
        zoom: -2,
        minZoom: -6,
        maxZoom: 1,
        center: [0, 0],
        zoomControl: false,
        attributionControl: false,
        crs: L.CRS.Simple
    })

    zoom = L.control.zoom({
        position: i18n.t('locale.text_direction') === 'ltr' ? 'topright' : 'topleft'
    })
    zoom.addTo(map)

    biomeLayer = new BiomeLayer({
            tileSize: 256,
            minZoom: -100
        },
        do_hillshade,
        show_sealevel,
        project_down,
        y,
        show_heightmap,
        surface_biomes,
        hillshade_strength,
        cave_view
    )

    map.addLayer(biomeLayer)

    spawnMarker = L.marker({lat: 0, lng: 0}, {
        icon: L.icon({
            iconUrl: "images/spawn_icon.png",
            iconAnchor: [16, 16],
            popupAnchor: [0, -10]
        }),
    }).bindPopup(L.popup())

    updateSpawnMarker()

    markers = L.layerGroup().addTo(map)

    map.addEventListener("mousemove", (evt: L.LeafletMouseEvent) => updateTooltip(map, evt))


    map.addEventListener("mouseout", (evt: L.LeafletMouseEvent) => {
        show_tooltip.value = false
    })

    map.addEventListener("contextmenu", async (evt: L.LeafletMouseEvent) => {
        const pos = getPosition(map, evt.latlng)
        navigator.clipboard.writeText(`/execute in ${settingsStore.dimension.toString()} run tp ${pos[0].toFixed(0)} ${(pos[1] + (project_down.value ? 10 : 0)).toFixed(0)} ${pos[2].toFixed()}`)
        show_info.value = true
        setTimeout(() => show_info.value = false, 2000)
    })


    map.on("moveend", (evt) => {
        setTimeout(updateMarkers, 5)
        syncCompareFromMain()
        updateResetToPlayerVisibility()
    })

    map.on("zoomend", () => {
        syncCompareFromMain()
        updateResetToPlayerVisibility()
    })

    graticule = new Graticule()

    /*
    layer.on("tileunload", (evt) => {
        // @ts-expect-error: _tileCoordsToBounds does not exist
        const tileBounds = layer._tileCoordsToBounds(evt.coords);

    })*/

});

datapackStore.onTuningChanged(() => {
    refreshTooltipSurfaceDensityFunction()
    refreshCompareDifferenceSoon(250)
})

watch(show_compare, async (value) => {
    if (value) {
        await nextTick()
        createCompareMap()
    } else {
        show_compare_difference.value = false
        destroyCompareMap()
    }
})

watch(i18n.locale, () => {
    zoom.setPosition(i18n.t('locale.text_direction') === 'ltr' ? 'topright' : 'topleft')
})

function getPosition(map: L.Map, latlng: L.LatLng) {
    const crs = map.options.crs!
    const pos = crs.project(latlng)
    pos.y *= -1

    const sourceLayer = map === compareMap ? compareBiomeLayer : biomeLayer
    const tileSurface = sourceLayer?.getSurfaceAtBlock(pos.x, pos.y)
    const fallbackSurface = tooltipSurfaceDensityFunction?.compute(DensityFunction.context((pos.x >> 2) << 2, y.value, (pos.y >> 2) << 2)) ?? Number.POSITIVE_INFINITY
    const surface = tileSurface ?? fallbackSurface

    const pos_y: number = cave_view.value !== "off" ? y.value : project_down.value ? Math.min(surface, y.value) : y.value
    return BlockPos.create(pos.x, pos_y, pos.y)
}

function isInBounds(pos: ChunkPos, min: ChunkPos, max: ChunkPos) {
    return (pos[0] >= min[0] && pos[0] <= max[0] && pos[1] >= min[1] && pos[1] <= max[1])
}


function updateMarkers() {
    const biomeSource = loadedDimensionStore.getBiomeSource()
    if (biomeSource === undefined) {
        return
    }

    const cachedBiomeSource = new CachedBiomeSource(biomeSource)
    const context = new WorldgenStructure.GenerationContext(settingsStore.seed, cachedBiomeSource, loadedDimensionStore.noise_generator_settings, loadedDimensionStore.loaded_dimension.level_height ?? {minY: 0, height: 256})

    const bounds = map.getBounds()

    const crs = map.options.crs!
    const minPos = crs.project(bounds.getNorthWest())
    const maxPos = crs.project(bounds.getSouthEast())

    const minChunk = ChunkPos.create(minPos.x >> 4, -minPos.y >> 4)
    const maxChunk = ChunkPos.create(maxPos.x >> 4, -maxPos.y >> 4)

    var _needs_zoom = false

    const keptMarkers: Set<string> = new Set()

    const scheduler = ('scheduler' in window) ? ((task: () => void) => (window as any).scheduler.postTask(task, {priority: "background"})) : ((task: () => void) => setTimeout(task, 1))

    for (const id of searchStore.structure_sets.sets) {
        const set = StructureSet.REGISTRY.get(id)
        if (!set) continue

        var minZoom = 2

        if (set.placement instanceof StructurePlacement.ConcentricRingsStructurePlacement){
            set.placement.prepare(biomeSource, loadedDimensionStore.sampler, settingsStore.seed)
            minZoom = -2
        } else if (set.placement instanceof StructurePlacement.RandomSpreadStructurePlacement) {
            const chunkFrequency = (set.placement.frequency) / (set.placement.spacing * set.placement.spacing)
            minZoom = -Math.log2(1/(chunkFrequency * 128))
        }

        if (map.getZoom() >= minZoom){
            const chunks: ChunkPos[] = set.placement.getPotentialStructureChunks(settingsStore.seed, minChunk[0], minChunk[1], maxChunk[0], maxChunk[1])

            for (const chunk of chunks) {
                const storage_id = `${id.toString()} ${chunk[0]},${chunk[1]}`
                const inBounds = isInBounds(chunk, minChunk, maxChunk)
                const stored = marker_map.get(storage_id)

                if (inBounds){
                    if (stored === undefined) {
                        const m: { marker?: L.Marker, structure?: {id: Identifier, pos: BlockPos} } = {}

                        marker_map.set(storage_id, m)


                        scheduler(() => {
                            if (marker_map.get(storage_id) !== m) return

                            cachedBiomeSource.setupCache(chunk[0] << 2, chunk[1] << 2)
                            const structure = set.getStructureInChunk(chunk[0], chunk[1], context)

                            const marker = structure && searchStore.structures.has(structure.id.toString()) ? getMarker(structure.id, structure.pos) : undefined
                            m.structure = structure
                            m.marker = marker
                        })
                    } else {
                        if (stored.structure){
                            const should_have_marker = searchStore.structures.has(stored.structure?.id.toString())
                            if (should_have_marker && stored.marker === undefined){
                                stored.marker = getMarker(stored.structure.id, stored.structure.pos)
                            } else if (!should_have_marker && stored.marker !== undefined){
                                stored.marker.remove()
                                stored.marker = undefined
                            }
                        }
                    }
                    keptMarkers.add(storage_id)
                }
            }
        } else {
            _needs_zoom = true
        }
    }

    for (const key of marker_map.keys()){
        if (!keptMarkers.has(key)){
            const marker = marker_map.get(key)
            marker?.marker?.remove()
            marker_map.delete(key)
        }
    }

    needs_zoom.value = _needs_zoom
}

function getMarker(structureId: Identifier, pos: BlockPos) {
    const crs = map.options.crs!
    const mapPos = new L.Point(pos[0], -pos[2])
    const popup = L.popup().setContent(() => `${settingsStore.getLocalizedName("structure", structureId, false)}<br />${i18n.t("map.coords.xyz", {x: pos[0], y: pos[1], z: pos[2]})}`)
    const marker = L.marker(crs.unproject(mapPos))
    marker.bindPopup(popup).addTo(markers)
    const iconUrl = loadedDimensionStore.getIcon(structureId)
    marker.setIcon(L.icon({
        iconUrl: iconUrl,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        shadowUrl: 'shadow.png',
        shadowSize: [40, 40],
        shadowAnchor: [20, 20],
        popupAnchor: [0, -10]
    }))
    return marker
}

function updateSpawnMarker(){
    if (settingsStore.dimension.toString() === "minecraft:overworld"){
        const crs = map.options.crs!
        const spawnTarget = SpawnTarget.fromJson(loadedDimensionStore.loaded_dimension.noise_settings_json?.spawn_target, versionMetadata[settingsStore.mc_version].spawnAlgorithm)
        const spawn = spawnTarget.getSpawnPoint(loadedDimensionStore.sampler)
        const pos = new L.Point(spawn[0] + 7, - spawn[1] - 7)
        spawnMarker.setLatLng(crs.unproject(pos))
        spawnMarker.bindPopup(L.popup().setContent(() => `${i18n.t("map.tooltip.spawn")}<br />${i18n.t("map.coords.xz", {x: spawn[0] + 7, z: spawn[1] + 7})}`))
        spawnMarker.addTo(map)
    } else {
        spawnMarker.removeFrom(map)
    }

    updateResetToPlayerVisibility()
}

function updateResetToPlayerVisibility() {
    if (!map || !spawnMarker) {
        show_reset_to_player.value = false
        return
    }

    const hasPlayerMarker = map.hasLayer(spawnMarker)
    show_reset_to_player.value = hasPlayerMarker && !map.getBounds().pad(-0.08).contains(spawnMarker.getLatLng())
}

function resetCameraToPlayer() {
    if (!map || !spawnMarker || !map.hasLayer(spawnMarker)) return
    map.setView(spawnMarker.getLatLng(), map.getZoom(), { animate: true })
    syncCompareFromMain()
    setTimeout(updateResetToPlayerVisibility, 200)
}

function syncMapView(source: L.Map, target: L.Map) {
    if (syncingMaps) return
    const sourceCenter = source.getCenter()
    const targetCenter = target.getCenter()
    if (
        source.getZoom() === target.getZoom()
        && Math.abs(sourceCenter.lat - targetCenter.lat) < 0.000001
        && Math.abs(sourceCenter.lng - targetCenter.lng) < 0.000001
    ) {
        return
    }
    syncingMaps = true
    target.setView(sourceCenter, source.getZoom(), { animate: false })
    syncingMaps = false
}

function syncCompareFromMain() {
    if (!compareMap) return
    syncMapView(map, compareMap)
}

function refreshCompareDifferenceSoon(delay = 80) {
    if (!show_compare_difference.value || !compareBiomeLayer) return
    if (compareDifferenceRefreshTimeout !== undefined) {
        window.clearTimeout(compareDifferenceRefreshTimeout)
    }
    compareDifferenceRefreshTimeout = window.setTimeout(() => {
        compareDifferenceRefreshTimeout = undefined
        compareBiomeLayer?.rerender()
        updateCompareDifferenceStats()
    }, delay)
}

function resetCompareDifferenceStats() {
    compare_difference_stats.value = { total: 0, changed: 0, changedPercent: 0, maxDelta: 0, averageDelta: 0, clipCount: 0 }
}

function updateCompareDifferenceStats() {
    if (!show_compare.value || !show_compare_difference.value || !compareBiomeLayer) {
        resetCompareDifferenceStats()
        return
    }
    compare_difference_stats.value = compareBiomeLayer.getDifferenceStats(compare_difference_filter.value)
}

function createCompareMap() {
    if (compareMap) {
        syncCompareFromMain()
        compareMap.invalidateSize()
        return
    }

    compareMap = L.map("compare_map", {
        zoom: map.getZoom(),
        minZoom: -6,
        maxZoom: 1,
        center: map.getCenter(),
        zoomControl: false,
        attributionControl: false,
        crs: L.CRS.Simple
    })

    compareBiomeLayer = new BiomeLayer({
            tileSize: 256,
            minZoom: -100
        },
        do_hillshade,
        show_sealevel,
        project_down,
        y,
        show_heightmap,
        surface_biomes,
        hillshade_strength,
        cave_view,
        datapackStore.baseline_composite_datapack,
        show_compare_difference,
        biomeLayer,
        compare_difference_filter,
        show_clip_warning
    )

    compareMap.addLayer(compareBiomeLayer)
    compareDifferenceUnsubscribe = biomeLayer.onTilesRendered(() => refreshCompareDifferenceSoon())
    compareStatsUnsubscribe = compareBiomeLayer.onTilesRendered(() => updateCompareDifferenceStats())

    compareMap.on("moveend", () => {
        if (compareMap) syncMapView(compareMap, map)
        updateCompareDifferenceStats()
    })
    compareMap.on("zoomend", () => {
        if (compareMap) syncMapView(compareMap, map)
        updateCompareDifferenceStats()
    })
    compareMap.addEventListener("mousemove", (evt: L.LeafletMouseEvent) => {
        if (compareMap) updateTooltip(compareMap, evt)
    })
    compareMap.addEventListener("mouseout", () => {
        show_tooltip.value = false
    })

    setTimeout(() => {
        map.invalidateSize()
        compareMap?.invalidateSize()
        syncCompareFromMain()
    }, 0)
}

function destroyCompareMap() {
    if (!compareMap) return
    if (compareDifferenceRefreshTimeout !== undefined) {
        window.clearTimeout(compareDifferenceRefreshTimeout)
        compareDifferenceRefreshTimeout = undefined
    }
    compareDifferenceUnsubscribe?.()
    compareDifferenceUnsubscribe = undefined
    compareStatsUnsubscribe?.()
    compareStatsUnsubscribe = undefined
    compareMap.remove()
    compareMap = undefined
    compareBiomeLayer = undefined
    resetCompareDifferenceStats()
    setTimeout(() => map.invalidateSize(), 0)
}

function clampYToLevelHeight(levelHeight: { minY: number, height: number }) {
    y.value = Math.max(Math.min(y.value, levelHeight.minY + levelHeight.height), levelHeight.minY)
}

function levelHeightKey(levelHeight: { minY: number, height: number }) {
    return `${levelHeight.minY}:${levelHeight.height}`
}

const initialLevelHeight = loadedDimensionStore.loaded_dimension.level_height
if (initialLevelHeight) {
    lastLevelHeightKey = levelHeightKey(initialLevelHeight)
    if (project_down.value && loadedDimensionStore.surface_density_function !== undefined) {
        y.value = initialLevelHeight.minY + initialLevelHeight.height || y.value
    } else {
        clampYToLevelHeight(initialLevelHeight)
    }
}

loadedDimensionStore.$subscribe((mutation, state) => {
    for (const marker of marker_map.values()){
        marker.marker?.remove()
    }
    marker_map.clear()
    updateMarkers()
    updateSpawnMarker()

    const level_height = loadedDimensionStore.loaded_dimension.level_height
    if (level_height){
        refreshTooltipSurfaceDensityFunction()
        const nextLevelHeightKey = levelHeightKey(level_height)
        const levelHeightChanged = nextLevelHeightKey !== lastLevelHeightKey
        lastLevelHeightKey = nextLevelHeightKey

        if (levelHeightChanged && project_down.value && loadedDimensionStore.surface_density_function !== undefined){
            y.value = level_height.minY + level_height.height || y.value
        } else {
            clampYToLevelHeight(level_height)
        }
    } 
})

watch(searchStore.structures, () => {
    updateMarkers()
})

watch([show_compare_difference, compare_difference_filter, show_clip_warning], () => {
    setTimeout(() => updateCompareDifferenceStats(), 0)
})

</script>
  
<template>
    <div id="map_container">
        <div id="map">
            <span v-if="show_compare" class="compare-label tuned">Tuned</span>
        </div>
        <div id="compare_map" v-if="show_compare">
            <span class="compare-label baseline">Default</span>
        </div>
        <div class="map_options">
            <Suspense>
                <YSlider class="slider" v-model:y="y" />
            </Suspense>
            <MapButton icon="fa-arrows-down-to-line" :disabled="loadedDimensionStore.surface_density_function === undefined" v-model="project_down" :title="i18n.t('map.setting.project')" />
            <MapButton icon="fa-layer-group" :disabled="!project_down || loadedDimensionStore.surface_density_function === undefined" v-model="surface_biomes" title="Surface biome layer" />
            <label class="cave-view" title="Cave view mode">
                <span>Cave</span>
                <select v-model="cave_view" aria-label="Cave view mode">
                    <option value="off">Off</option>
                    <option value="layered">Layered</option>
                    <option value="full">Full</option>
                </select>
            </label>
            <MapButton icon="fa-mountain-sun" :disabled="(!project_down || loadedDimensionStore.surface_density_function === undefined) && ! loadedDimensionStore.terrain_density_function" v-model="do_hillshade"  :title="i18n.t('map.setting.hillshade')" />
            <label class="hillshade-strength" title="Hillshade strength">
                <font-awesome-icon icon="fa-sliders" />
                <input
                    type="range"
                    min="0"
                    max="2.5"
                    step="0.05"
                    v-model.number="hillshade_strength"
                    aria-label="Hillshade strength"
                />
            </label>
            <MapButton icon="fa-water" :disabled="loadedDimensionStore.surface_density_function === undefined" v-model="show_sealevel" :title="i18n.t('map.setting.sealevel')" />
            <MapButton icon="fa-chart-simple" v-model="show_heightmap" title="Heightmap grayscale view" />
            <MapButton icon="fa-table-cells" v-model="show_graticule" :title="i18n.t('map.setting.graticule')" />
            <MapButton icon="fa-code-compare" v-model="show_compare" title="Compare tuned values with default baseline" />
            <MapButton icon="fa-code-compare" :disabled="!show_compare" v-model="show_compare_difference" title="Highlight tuned differences in the default compare view" />
            <MapButton icon="fa-triangle-exclamation" :disabled="!show_compare" v-model="show_clip_warning" title="Highlight cells above playable build height" />
            <label class="difference-filter" :class="{ disabled: !show_compare_difference }" title="Difference filter">
                <font-awesome-icon icon="fa-filter" />
                <select v-model="compare_difference_filter" :disabled="!show_compare_difference" aria-label="Difference filter">
                    <option value="all">All</option>
                    <option value="cliffs">Cliffs</option>
                    <option value="mountains">Mountains</option>
                    <option value="peaks">Peaks</option>
                    <option value="coasts">Coasts</option>
                    <option value="ocean">Ocean</option>
                    <option value="caves">Caves</option>
                    <option value="biomes">Biomes</option>
                </select>
            </label>
        </div>
        <div class="difference-panel" v-if="show_compare && show_compare_difference">
            <div class="difference-panel-title">Diff {{ compare_difference_filter }}</div>
            <div class="difference-row">
                <span>Changed</span>
                <strong>{{ compare_difference_stats.changedPercent.toFixed(1) }}%</strong>
            </div>
            <div class="difference-row">
                <span>Max |ΔY|</span>
                <strong>{{ compare_difference_stats.maxDelta.toFixed(1) }} blocks</strong>
            </div>
            <div class="difference-row">
                <span>Avg |ΔY|</span>
                <strong>{{ compare_difference_stats.averageDelta.toFixed(1) }} blocks</strong>
            </div>
            <div class="difference-row warn" v-if="show_clip_warning">
                <span>Clip cells</span>
                <strong>{{ compare_difference_stats.clipCount }}</strong>
            </div>
            <div class="difference-legend">
                <span>-64</span>
                <div class="difference-gradient"></div>
                <span>+64</span>
            </div>
            <div class="difference-legend-caption">
                blue lower · red higher · magenta clips
            </div>
        </div>
        <button
            v-if="show_reset_to_player"
            type="button"
            class="reset-camera"
            :title="i18n.t('map.action.reset_camera_to_player')"
            @click="resetCameraToPlayer"
        >
            <font-awesome-icon icon="fa-location-dot" />
            <span>{{ i18n.t('map.action.reset_camera_to_player') }}</span>
        </button>
    </div>
    <BiomeTooltip id="tooltip" v-if="show_tooltip" :style="{ left: tooltip_left + 'px', top: tooltip_top + 'px' }"
        :biome="tooltip_biome" :pos="tooltip_position" />
    <div class="top">
        <Transition>
            <div class="info zoom" v-if="needs_zoom">
                {{ i18n.t('map.info.structures_hidden') }}
            </div>
        </Transition>
        <Transition>
            <div class="info unsupported" v-if="searchStore.structure_sets.has_invalid">
                {{ i18n.t('map.error.structures_unsupported') }}
            </div>
        </Transition>
    </div>
    <Transition>
        <div class="info bottom teleport" v-if="show_info">
            {{ i18n.t('map.info.teleport_command_copied') }}
        </div>
    </Transition>
</template>

<style scoped>
#map_container {
    width: 100%;
    flex-grow: 1;
    position: relative;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.25rem;
    background: var(--prism-bg);
}

#map_container:has(#compare_map) {
    grid-template-columns: 1fr 1fr;
}

#map,
#compare_map {
    width: 100%;
    height: 100%;
    min-width: 0;
    cursor: crosshair;
    position: relative;
    background: white url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" fill-opacity=".25" ><rect x="20" width="20" height="20" /><rect y="20" width="20" height="20" /></svg>');
    background-size: 25px 25px;
}

#map.leaflet-drag-target,
#compare_map.leaflet-drag-target {
    cursor: grab;
}

.compare-label {
    position: absolute;
    z-index: 650;
    left: 0.6rem;
    top: 0.6rem;
    padding: 0.22rem 0.55rem;
    border-radius: 0.35rem;
    background: rgba(5, 27, 34, 0.88);
    color: var(--prism-text);
    font-size: 0.78rem;
    pointer-events: none;
}

.compare-label.baseline {
    background: rgba(8, 54, 69, 0.88);
}

.map_options {
    position: absolute;
    z-index: 600;
    top: 5rem;
    right: 0.85rem;
    display: flex;
    flex-direction: column;
    align-items: end;
    gap: 0.5rem;
}

.map_options:dir(rtl) {
    right: unset;
    left: 0.85rem;
}

.hillshade-strength {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.28rem;
    width: 1.3rem;
    padding: 0.32rem;
    border: 2px solid rgba(5, 27, 34, 0.72);
    border-radius: 0.3rem;
    background: var(--prism-panel-3);
    color: var(--prism-text);
}

.hillshade-strength input {
    writing-mode: vertical-lr;
    direction: rtl;
    width: 1.1rem;
    height: 6rem;
    accent-color: var(--prism-active);
}

.cave-view {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.18rem;
    width: 4.75rem;
    padding: 0.28rem;
    border: 2px solid rgba(5, 27, 34, 0.72);
    border-radius: 0.3rem;
    background: var(--prism-panel-3);
    color: var(--prism-text);
    font-size: 0.68rem;
}

.cave-view select {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--prism-border);
    border-radius: 0.2rem;
    background: var(--prism-field);
    color: black;
    font-size: 0.68rem;
}

.difference-filter {
    display: flex;
    align-items: center;
    gap: 0.32rem;
    width: 7.25rem;
    padding: 0.32rem;
    border: 2px solid rgba(5, 27, 34, 0.72);
    border-radius: 0.3rem;
    background: var(--prism-panel-3);
    color: var(--prism-text);
}

.difference-filter.disabled {
    opacity: 0.58;
}

.difference-filter select {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--prism-border);
    border-radius: 0.2rem;
    background: var(--prism-field);
    color: black;
    font-size: 0.68rem;
}

.difference-panel {
    position: absolute;
    z-index: 610;
    right: 4.8rem;
    top: 5rem;
    min-width: 11.5rem;
    padding: 0.55rem;
    border: 1px solid rgba(104, 231, 241, 0.38);
    border-radius: 0.35rem;
    background: rgba(3, 28, 35, 0.9);
    color: var(--prism-text);
    box-shadow: 0 0.6rem 1.6rem rgba(0, 0, 0, 0.28);
    font-size: 0.72rem;
    pointer-events: none;
}

.difference-panel-title {
    margin-bottom: 0.35rem;
    color: #8cf8ff;
    font-weight: 700;
    text-transform: capitalize;
}

.difference-row {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    padding: 0.12rem 0;
}

.difference-row.warn strong {
    color: #ff62dd;
}

.difference-legend {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.35rem;
    margin-top: 0.45rem;
    color: rgba(226, 250, 255, 0.86);
}

.difference-gradient {
    height: 0.5rem;
    border-radius: 999px;
    background: linear-gradient(90deg, #1aaeff, #364048 50%, #ff2a4e);
    border: 1px solid rgba(226, 250, 255, 0.28);
}

.difference-legend-caption {
    margin-top: 0.25rem;
    color: rgba(226, 250, 255, 0.74);
    font-size: 0.64rem;
}

.reset-camera {
    position: absolute;
    z-index: 620;
    left: 50%;
    bottom: 1rem;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.42rem 0.72rem;
    border: 1px solid rgba(159, 243, 255, 0.58);
    border-radius: 999px;
    background: rgba(6, 39, 51, 0.88);
    color: var(--prism-text);
    box-shadow: 0 0.55rem 1.3rem rgba(0, 0, 0, 0.24);
    font-size: 0.78rem;
    line-height: 1;
    backdrop-filter: blur(5px);
}

.reset-camera:hover,
.reset-camera:focus-visible {
    background: var(--prism-active);
    color: rgb(2, 17, 22);
    border-color: var(--prism-accent-2);
}

#tooltip {
    position: absolute;
    pointer-events: none;
    z-index: 500;
}


.top{
    position: absolute;
    z-index: 500;
    left: 50%;
    transform: translateX(-50%);
    top: 0.5rem;
}

.bottom {
    position: absolute;
    z-index: 500;
    left: 50%;
    transform: translateX(-50%);
    bottom: 0.5rem;
}

.info {
    padding: 0.3rem;
    padding-left: 1rem;
    padding-right: 1rem;
    border-radius: 1rem;
    background-color: var(--prism-panel);
    color: rgb(255, 255, 255);
    user-select: none;
    margin: 0.2rem;
}

.teleport {
    color: rgb(189, 189, 189);
}

.unsupported {
    background-color: rgb(165, 33, 33);
    border: 2px solid white
}


</style>
