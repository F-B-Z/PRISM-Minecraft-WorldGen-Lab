import { BiomeSource, FixedBiomeSource, Identifier, StructureSet, Climate, DensityFunction, Holder, WorldgenRegistries, NoiseParameters, HolderSet, WorldgenStructure, Json, NoiseGeneratorSettings, RandomState, NoiseSettings, LevelHeight } from "deepslate";
import { ResourceLocation } from "mc-datapack-loader";
import { defineStore } from "pinia";
import { compile, computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getPreset } from "../BuildIn/MultiNoiseBiomeParameterList.js";
import { VANILLA_ITEMS } from "../BuildIn/VanillaItems.js";
import { getCustomDensityFunction, hashCode } from "../util.js";
import { useDatapackStore } from "./useDatapackStore.js";
import { useSettingsStore } from "./useSettingsStore.js";

import messages from '@intlify/unplugin-vue-i18n/messages'

type BiomeColor = { r: number, g: number, b: number }

export type LoadedDimension = {
    structure_icons?: Map<string, Identifier>,
    hidden_structures?: Set<string>
    level_height?: LevelHeight,
    noise_settings_id?: Identifier,
    noise_settings_json?: {[x: string]: unknown},
    biome_source_json?: {[x: string]: unknown},
}

export const useLoadedDimensionStore = defineStore('loaded_dimension', () => {

    const datapackStore = useDatapackStore()
    const settingsStore = useSettingsStore()
    const i18n = useI18n()

    const loaded_dimension = reactive<LoadedDimension>({})
    var biome_source: BiomeSource | undefined = undefined
    var biome_colors: Map<string, BiomeColor> = new Map<string, BiomeColor>()

    var default_messages: {[key: string]: string} = {}

    let reloadTimeout: number | undefined
    function queueReload() {
        if (reloadTimeout !== undefined) {
            window.clearTimeout(reloadTimeout)
        }
        reloadTimeout = window.setTimeout(() => {
            reloadTimeout = undefined
            reload().catch(error => console.warn("Failed to reload loaded dimension", error))
        }, 0)
    }

    datapackStore.$subscribe(queueReload)
    datapackStore.onTuningChanged(queueReload)

    watch(() => settingsStore.mc_version, reload)
    watch(() => settingsStore.world_preset, reload)
    watch(() => settingsStore.dimension, reload)
    watch(() => settingsStore.seed, reload)
    
    function handle_biome_colors(namespace:string, json: {[key: string]: { r: number, g: number, b: number, name?: string }}){
        for (const biome in json) {
            const biome_id = biome.indexOf(":") === -1 ? namespace + ":" + biome : biome

            const entry = json[biome]
            biome_colors.set(biome_id, {r: entry.r, g: entry.g, b: entry.b})
            if (entry.name){
                const [ns, path] = biome_id.split(':')
                default_messages[`minecraft.biome.${ns}.${path.replace('/','.')}`] = entry.name
            }
        }
    }

    const fallbackBiomeColors: Record<string, BiomeColor> = {
        "minecraft:badlands": { r: 167, g: 100, b: 62 },
        "minecraft:bamboo_jungle": { r: 50, g: 124, b: 47 },
        "minecraft:basalt_deltas": { r: 75, g: 72, b: 78 },
        "minecraft:beach": { r: 224, g: 204, b: 128 },
        "minecraft:birch_forest": { r: 89, g: 151, b: 79 },
        "minecraft:cherry_grove": { r: 192, g: 146, b: 172 },
        "minecraft:cold_ocean": { r: 66, g: 113, b: 157 },
        "minecraft:crimson_forest": { r: 128, g: 54, b: 65 },
        "minecraft:dark_forest": { r: 54, g: 96, b: 54 },
        "minecraft:deep_cold_ocean": { r: 44, g: 83, b: 130 },
        "minecraft:deep_dark": { r: 44, g: 49, b: 58 },
        "minecraft:deep_frozen_ocean": { r: 58, g: 103, b: 138 },
        "minecraft:deep_lukewarm_ocean": { r: 54, g: 121, b: 160 },
        "minecraft:deep_ocean": { r: 47, g: 91, b: 144 },
        "minecraft:desert": { r: 214, g: 190, b: 112 },
        "minecraft:dripstone_caves": { r: 124, g: 102, b: 82 },
        "minecraft:eroded_badlands": { r: 184, g: 118, b: 70 },
        "minecraft:flower_forest": { r: 99, g: 157, b: 82 },
        "minecraft:forest": { r: 67, g: 132, b: 66 },
        "minecraft:frozen_ocean": { r: 88, g: 134, b: 163 },
        "minecraft:frozen_peaks": { r: 196, g: 205, b: 203 },
        "minecraft:frozen_river": { r: 90, g: 139, b: 168 },
        "minecraft:grove": { r: 116, g: 145, b: 124 },
        "minecraft:ice_spikes": { r: 183, g: 205, b: 210 },
        "minecraft:jagged_peaks": { r: 174, g: 178, b: 176 },
        "minecraft:jungle": { r: 45, g: 129, b: 50 },
        "minecraft:lukewarm_ocean": { r: 65, g: 134, b: 170 },
        "minecraft:lush_caves": { r: 82, g: 134, b: 81 },
        "minecraft:mangrove_swamp": { r: 76, g: 104, b: 70 },
        "minecraft:meadow": { r: 129, g: 169, b: 91 },
        "minecraft:mushroom_fields": { r: 149, g: 113, b: 153 },
        "minecraft:ocean": { r: 60, g: 108, b: 163 },
        "minecraft:old_growth_birch_forest": { r: 82, g: 139, b: 75 },
        "minecraft:old_growth_pine_taiga": { r: 80, g: 120, b: 92 },
        "minecraft:old_growth_spruce_taiga": { r: 76, g: 112, b: 88 },
        "minecraft:plains": { r: 126, g: 170, b: 82 },
        "minecraft:river": { r: 63, g: 124, b: 177 },
        "minecraft:savanna": { r: 169, g: 170, b: 83 },
        "minecraft:savanna_plateau": { r: 154, g: 155, b: 82 },
        "minecraft:snowy_beach": { r: 202, g: 205, b: 178 },
        "minecraft:snowy_plains": { r: 190, g: 207, b: 188 },
        "minecraft:snowy_slopes": { r: 186, g: 194, b: 188 },
        "minecraft:snowy_taiga": { r: 139, g: 166, b: 152 },
        "minecraft:soul_sand_valley": { r: 102, g: 85, b: 76 },
        "minecraft:sparse_jungle": { r: 59, g: 134, b: 57 },
        "minecraft:stony_peaks": { r: 142, g: 139, b: 120 },
        "minecraft:stony_shore": { r: 152, g: 145, b: 118 },
        "minecraft:sunflower_plains": { r: 143, g: 176, b: 80 },
        "minecraft:swamp": { r: 79, g: 111, b: 70 },
        "minecraft:taiga": { r: 80, g: 124, b: 91 },
        "minecraft:the_void": { r: 42, g: 45, b: 51 },
        "minecraft:warm_ocean": { r: 54, g: 150, b: 181 },
        "minecraft:warped_forest": { r: 50, g: 111, b: 105 },
        "minecraft:windswept_forest": { r: 96, g: 133, b: 88 },
        "minecraft:windswept_gravelly_hills": { r: 138, g: 139, b: 119 },
        "minecraft:windswept_hills": { r: 119, g: 140, b: 101 },
        "minecraft:windswept_savanna": { r: 148, g: 152, b: 86 },
        "minecraft:wooded_badlands": { r: 151, g: 104, b: 72 }
    }

    function fallbackColorFromName(id: string): BiomeColor {
        const direct = fallbackBiomeColors[id]
        if (direct !== undefined) return direct

        const path = id.includes(":") ? id.split(":", 2)[1] : id
        if (path.includes("deep") && path.includes("ocean")) return { r: 43, g: 84, b: 132 }
        if (path.includes("ocean")) return { r: 62, g: 116, b: 166 }
        if (path.includes("river")) return { r: 69, g: 132, b: 178 }
        if (path.includes("beach")) return { r: 220, g: 203, b: 133 }
        if (path.includes("snow") || path.includes("frozen") || path.includes("ice")) return { r: 190, g: 204, b: 198 }
        if (path.includes("peak") || path.includes("mountain") || path.includes("cliff")) return { r: 145, g: 149, b: 135 }
        if (path.includes("desert") || path.includes("dune")) return { r: 212, g: 188, b: 109 }
        if (path.includes("badlands") || path.includes("mesa")) return { r: 166, g: 101, b: 65 }
        if (path.includes("swamp") || path.includes("marsh")) return { r: 76, g: 106, b: 70 }
        if (path.includes("jungle")) return { r: 45, g: 126, b: 50 }
        if (path.includes("forest") || path.includes("wood")) return { r: 63, g: 125, b: 64 }
        if (path.includes("taiga")) return { r: 78, g: 122, b: 91 }
        if (path.includes("cave") || path.includes("cavern")) return { r: 93, g: 89, b: 84 }
        if (path.includes("mushroom")) return { r: 143, g: 112, b: 150 }
        if (path.includes("savanna")) return { r: 165, g: 166, b: 84 }
        if (path.includes("plains") || path.includes("meadow") || path.includes("field")) return { r: 125, g: 169, b: 84 }

        const hash = Math.abs(hashCode(id))
        const variants: BiomeColor[] = [
            { r: 101, g: 151, b: 82 },
            { r: 88, g: 136, b: 99 },
            { r: 129, g: 151, b: 89 },
            { r: 112, g: 139, b: 119 },
            { r: 136, g: 137, b: 104 }
        ]
        return variants[hash % variants.length]
    }

    function handle_structure_icons(namespace: string, json: {[key: string]: {item?: string, hidden?: boolean, name?: string} | string}, ld: LoadedDimension ){
        for (const structure in json) {
            const structure_id = structure.indexOf(":") === -1 ? namespace + ":" + structure : structure

            const structure_config = json[structure]

            // legacy string handling
            if (typeof structure_config === 'string'){
                if (structure_config === 'hidden'){
                    ld.hidden_structures?.add(structure_id)
                } else {
                    ld.structure_icons?.set(structure_id, Identifier.parse(structure_config))
                }
                return 
            }
            // legacy hidden in structure file
            if (structure_config.hidden){
                ld.hidden_structures?.add(structure_id)
            // TODO: use defined texture
            // stable: set item as display
            } else if (structure_config.item){
                ld.structure_icons?.set(structure_id, Identifier.parse(structure_config.item))
            }

            if (structure_config.name){
                const [ns, path] = structure_id.split(':')
                default_messages[`minecraft.structure.${ns}.${path.replace('/','.')}`] = structure_config.name
            }
        }
    }

    async function reload() {
        await datapackStore.reloadDatapack()

        const ld: LoadedDimension = {}

        biome_colors.clear()
        ld.structure_icons = new Map<string, Identifier>()
        ld.hidden_structures = new Set()
        default_messages = {}

        // legacy biome_colors and structure_icons
        const ids = await (datapackStore.composite_datapack.getIds(ResourceLocation.DATA_FILE))
        for (const id of ids) {
            if (id.path === "biome_colors"){
                const json = await datapackStore.composite_datapack.get(ResourceLocation.DATA_FILE, id) as {[key: string]: { r: number, g: number, b: number, name?: string }}
                handle_biome_colors(id.namespace, json)
            } else if (id.path === "structure_icons"){
                const json = await datapackStore.composite_datapack.get(ResourceLocation.DATA_FILE, id) as {[key: string]: {item?: string, hidden?: boolean, name?: string} | string}
                handle_structure_icons(id.namespace, json, ld)
            }
        }

        // stable biome_colors
        const biome_colors_json = await datapackStore.composite_datapack.get(ResourceLocation.DATA_FILE, new Identifier("c", "worldgen/biome_colors")) as {[key: string]: { r: number, g: number, b: number }}
        handle_biome_colors("c", biome_colors_json)

        // stable structure_icons
        const structure_icons_json = await datapackStore.composite_datapack.get(ResourceLocation.DATA_FILE, new Identifier("c", "worldgen/structure_icons")) as {[key: string]: {item?: string, hidden?: boolean} | string}
        handle_structure_icons("c", structure_icons_json, ld)

        // stable c:hide_on_map structure tag
        for (const holder of WorldgenStructure.REGISTRY.getTagRegistry().get(new Identifier("jacobsjo", "hidden_from_map"))?.getEntries() ?? []){
            ld.hidden_structures.add(holder.key()?.toString() ?? "")
        }

        const langs = await datapackStore.composite_datapack.getIds(ResourceLocation.LANGUAGE)

        for (const locale of i18n.availableLocales){
            const minecraft_messages: {[key: string]: string} = {}
            const minecraft_locale = i18n.t('locale.minecraft_locale', 1, {locale: locale})
            for (const lang of langs.filter(l => l.path === minecraft_locale)){
                const json = await datapackStore.composite_datapack.get(ResourceLocation.LANGUAGE, lang) as any
                for (const key in json){
                    minecraft_messages[`minecraft.${key}`] = json[key]
                }
            }

            i18n.setLocaleMessage(locale, messages?.[locale] ?? {}) 
            if (locale === "en"){
                i18n.mergeLocaleMessage(locale, default_messages)
            }
            i18n.mergeLocaleMessage(locale, minecraft_messages)
        }

        var dimension_json: any

        if (await datapackStore.composite_datapack.has(ResourceLocation.DIMENSION, settingsStore.dimension)) {
            dimension_json = await datapackStore.composite_datapack.get(ResourceLocation.DIMENSION, settingsStore.dimension)
        } else {
            const world_preset_json = (await datapackStore.composite_datapack.get(ResourceLocation.WORLDGEN_WORLD_PRESET, settingsStore.world_preset)) as { dimensions: { [key: string]: any } }
            dimension_json = world_preset_json.dimensions[settingsStore.dimension.toString()]
        }

        const dimension_type_id = Identifier.parse(dimension_json.type)
        const dimension_type_json = await datapackStore.composite_datapack.get(ResourceLocation.DIMENSION_TYPE, dimension_type_id) as any
        ld.level_height = {minY: dimension_type_json.min_y, height: dimension_type_json.height}

        // get json of noise generator
        const generator = Json.readObject(dimension_json.generator) ?? {}
        if (generator?.type !== "minecraft:noise") {
            throw new Error("Dimension without noise generator")
        }

        // get Noise Settings json (from inline or from datapack)
        if (typeof generator.settings === "object") {
            ld.noise_settings_json = Json.readObject(generator.settings) ?? {}
            ld.noise_settings_id = Identifier.parse("inline:inline")
        } else if (typeof generator.settings === "string") {
            ld.noise_settings_id = Identifier.parse(Json.readString(generator.settings) ?? "")
            ld.noise_settings_json = Json.readObject(await datapackStore.composite_datapack.get(ResourceLocation.WORLDGEN_NOISE_SETTINGS, ld.noise_settings_id))
        } else {
            throw new Error("Malformed generator")
        }

        // if multi noise is using preset, fill in Build-In biome list
        ld.biome_source_json = Json.readObject(generator.biome_source) ?? {}
        if (ld.biome_source_json.type === "minecraft:multi_noise" && "preset" in ld.biome_source_json) {
            let preset = Json.readString(ld.biome_source_json.preset) ?? ""
            const preset_id = Identifier.parse(preset)
            if (await datapackStore.composite_datapack.has(ResourceLocation.WORLDGEN_MULTI_NOISE_BIOME_SOURCE_PRARAMETER_LIST, preset_id)) {
                const parameter_list = await datapackStore.composite_datapack.get(ResourceLocation.WORLDGEN_MULTI_NOISE_BIOME_SOURCE_PRARAMETER_LIST, preset_id) as { preset: string }
                preset = parameter_list.preset
            }
            ld.biome_source_json.biomes = getPreset(preset, settingsStore.mc_version)
        }



        Object.assign(loaded_dimension, ld)
        biome_source = BiomeSource.fromJson(ld.biome_source_json)

    }

    const noise_generator_settings = computed(() => NoiseGeneratorSettings.fromJson(loaded_dimension.noise_settings_json))

    const random_state = computed(() => {
        return new RandomState(noise_generator_settings.value, settingsStore.seed)
    })

    const sampler = computed(() => {
        const router = (random_state.value).router
        return Climate.Sampler.fromRouter(router)
    })

    const surface_density_function = computed(() => {
        const surface_density_function_id = getCustomDensityFunction("snowcapped_surface", loaded_dimension.noise_settings_id ?? Identifier.create("empty"), settingsStore.dimension)
        if (surface_density_function_id !== undefined){
            return new DensityFunction.HolderHolder(Holder.reference(WorldgenRegistries.DENSITY_FUNCTION, surface_density_function_id)).mapAll((random_state.value).createVisitor((noise_generator_settings.value).noise, (noise_generator_settings.value).legacyRandomSource))
        } else {
            return undefined
        }
    })

    const terrain_density_function = computed(() => {
        const surface_density_function_id = getCustomDensityFunction("map_simple_terrain", loaded_dimension.noise_settings_id ?? Identifier.create("empty"), settingsStore.dimension)
        if (surface_density_function_id !== undefined){
            return new DensityFunction.HolderHolder(Holder.reference(WorldgenRegistries.DENSITY_FUNCTION, surface_density_function_id)).mapAll((random_state.value).createVisitor((noise_generator_settings.value).noise, (noise_generator_settings.value).legacyRandomSource))
        } else {
            return undefined
        }
    })    

    function getIcon(id: Identifier){
        const item = loaded_dimension.structure_icons?.get(id.toString()) ?? Identifier.create(VANILLA_ITEMS[Math.abs(hashCode(id.toString())) % VANILLA_ITEMS.length]) 
        return `https://raw.githubusercontent.com/jacobsjo/mcicons/icons/item/${item.path}.png`
    }

    function getBiomeColor(id: string){
        var biomeColor = biome_colors.get(id)
        if (biomeColor === undefined) {
            biomeColor = fallbackColorFromName(id)
        }
        return biomeColor
    }

    function getBiomeSource(){
        return biome_source
    }

    return { loaded_dimension, noise_generator_settings, sampler, surface_density_function, terrain_density_function, reload, getIcon, getBiomeColor, getBiomeSource }
})

