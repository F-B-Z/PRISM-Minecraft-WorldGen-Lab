import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { ResourceLocation } from "mc-datapack-loader";
import { DensityFunction, Holder, Identifier, NoiseParameters, WorldgenRegistries } from "deepslate";
import JSZip from "jszip";
import { invoke } from "@tauri-apps/api/core";
import { useDatapackStore } from "./useDatapackStore.js";
import { useSettingsStore } from "./useSettingsStore.js";
import { prismTuningDatapack } from "./prismTuningDatapack.js";
import { useMdfModeStore } from "./useMdfModeStore.js";
import { versionMetadata } from "../util.js";
import { parseDensityFunctionWithMdfMode } from "../util/moreDensityFunctions.js";
import bundledPresetPackUrl from "../assets/prism-worldgen-lab-presets.json?url";
import bundledAnnotationPackUrl from "../assets/prism-worldgen-lab-annotations.json?url";

export type PrismTuningCategoryId = string;
export type PrismTuningKind = "noise" | "density_function";
export type JsonPath = (string | number)[];

export type PrismTuningResource = {
    category: PrismTuningCategoryId;
    kind: PrismTuningKind;
    id: string;
    title: string;
}

export type NumericSetting = {
    key: string;
    path: JsonPath;
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
}

type LoadedResource = {
    resource: PrismTuningResource;
    original: unknown;
    working: unknown;
    settings: NumericSetting[];
}

type PresetOverride = {
    kind: PrismTuningKind;
    resource: string;
    pointer: string;
    value: number;
}

export type PrismLabPreset = {
    id: string;
    name: string;
    group: string;
    description: string;
    overrides: PresetOverride[];
}

type PresetPack = {
    schema: string;
    version?: number;
    groups?: string[];
    presets?: PrismLabPreset[];
}

type PresetExportOverride = PresetOverride & {
    label?: string;
}

type SettingAliasMetadata = {
    resourceKey: string;
    category: PrismTuningCategoryId;
    kind: PrismTuningKind;
    resourceId: string;
    resourceTitle: string;
    settingKey: string;
    label: string;
    path: JsonPath;
    jsonPointer: string;
    lastValue: number;
}

export type PrismTuningTreeCategory = {
    id: string;
    title: string;
    kinds: {
        density_function: PrismTuningResource[];
        noise: PrismTuningResource[];
    };
}

const resourceAliasStorageKey = "prism-worldgen-lab.resource-aliases.v1";
const settingAliasStorageKey = "prism-worldgen-lab.setting-aliases.v1";
const settingMetadataStorageKey = "prism-worldgen-lab.setting-alias-metadata.v1";

const resourceLocations: Record<PrismTuningKind, ResourceLocation> = {
    noise: ResourceLocation.WORLDGEN_NOISE,
    density_function: ResourceLocation.WORLDGEN_DENSITY_FUNCTION
}

function cloneJson<T>(data: T): T {
    return JSON.parse(JSON.stringify(data));
}

function resourceTitle(id: Identifier): string {
    return id.path.split("/").reverse()[0];
}

function categoryTitle(namespace: string): string {
    if (namespace === "minecraft") return "Minecraft";
    return namespace
        .split(/[_-]/g)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function resourceKey(resource: PrismTuningResource): string {
    return `${resource.kind}:${resource.id}`;
}

function settingLabel(path: JsonPath): string {
    return path.map(segment => typeof segment === "number" ? `[${segment}]` : segment).join(".");
}

function settingKey(path: JsonPath): string {
    return path.map(segment => String(segment)).join("/");
}

function registerRuntimeResource(resource: PrismTuningResource, data: unknown) {
    const id = Identifier.parse(resource.id);
    if (resource.kind === "density_function") {
        const mdfModeStore = useMdfModeStore();
        const densityFunction = new DensityFunction.HolderHolder(
            Holder.parser(WorldgenRegistries.DENSITY_FUNCTION, obj => parseDensityFunctionWithMdfMode(obj, mdfModeStore.enabled))(data)
        );
        WorldgenRegistries.DENSITY_FUNCTION.register(id, densityFunction);
    } else {
        WorldgenRegistries.NOISE.register(id, NoiseParameters.fromJson(data));
    }
}

function resourceAliasKey(resource: PrismTuningResource): string {
    return `${resource.kind}:${resource.id}`;
}

function settingAliasKey(resource: PrismTuningResource, settingKey: string): string {
    return `${resourceAliasKey(resource)}#${settingKey}`;
}

function pathToJsonPointer(path: JsonPath): string {
    return "/" + path.map(segment => String(segment).replaceAll("~", "~0").replaceAll("/", "~1")).join("/");
}

function resourceFilePath(location: ResourceLocation, id: Identifier): string {
    return `${location.type}/${id.namespace}/${location.location}/${id.path}.json`;
}

function safeFileStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeFileNamePart(value: string) {
    return value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "custom";
}

async function saveBlobViaDesktopApp(blob: Blob, fileName: string): Promise<string | undefined> {
    try {
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        return await invoke<string>("save_datapack_export", { fileName, bytes });
    } catch (e) {
        console.warn("Native export failed, falling back to browser download.", e);
        return undefined;
    }
}

function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStoredRecord<T extends Record<string, unknown>>(key: string): T {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return {} as T;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : {} as T;
    } catch {
        return {} as T;
    }
}

function writeStoredRecord(key: string, value: Record<string, unknown>) {
    localStorage.setItem(key, JSON.stringify(value));
}

function rangeFor(basisValue: number, path: JsonPath, currentValue = basisValue): { min: number, max: number, step: number } {
    const last = String(path[path.length - 1] ?? "");
    if (last === "firstOctave") {
        return { min: -32, max: 8, step: 1 };
    }
    if (last === "derivative") {
        return { min: Math.min(-4, currentValue), max: Math.max(4, currentValue), step: 0.01 };
    }
    if (last === "location") {
        const span = Math.max(2, Math.abs(basisValue) * 2);
        return { min: Math.min(-2, basisValue - span, currentValue), max: Math.max(2, basisValue + span, currentValue), step: 0.01 };
    }
    if (last.includes("scale")) {
        const upper = Math.max(4, Math.abs(basisValue) * 3, basisValue + 2, currentValue);
        return { min: Math.min(0, currentValue), max: upper, step: basisValue >= 10 ? 1 : 0.01 };
    }
    const magnitude = Math.max(1, Math.abs(basisValue));
    return { min: Math.min(basisValue - magnitude * 2, currentValue), max: Math.max(basisValue + magnitude * 2, currentValue), step: magnitude >= 10 ? 0.1 : 0.01 };
}

function collectNumbers(value: unknown, path: JsonPath = [], out: NumericSetting[] = [], rangeSource?: unknown): NumericSetting[] {
    if (typeof value === "number" && Number.isFinite(value)) {
        const basisValue = getAtPath(rangeSource, path);
        const range = rangeFor(typeof basisValue === "number" && Number.isFinite(basisValue) ? basisValue : value, path, value);
        out.push({
            key: settingKey(path),
            path: [...path],
            label: settingLabel(path),
            value,
            ...range
        });
        return out;
    }

    if (Array.isArray(value)) {
        value.forEach((entry, index) => collectNumbers(entry, [...path, index], out, rangeSource));
        return out;
    }

    if (value && typeof value === "object") {
        Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
            collectNumbers(entry, [...path, key], out, rangeSource);
        });
    }

    return out;
}

function settingSortKey(setting: NumericSetting): string {
    const path = setting.path.map(segment => String(segment));
    const last = path[path.length - 1] ?? "";
    const directArgument = path.length === 1 && /^argument\d+$/.test(last) ? 0 : 1;
    const directNamedValue = path.length === 1 ? 0 : 1;
    const splinePoint = path.includes("points") ? 1 : 0;
    return [
        directArgument,
        directNamedValue,
        splinePoint,
        String(path.length).padStart(3, "0"),
        setting.label
    ].join("|");
}

function sortSettings(settings: NumericSetting[]): NumericSetting[] {
    return [...settings].sort((a, b) => settingSortKey(a).localeCompare(settingSortKey(b)));
}

function getAtPath(root: unknown, path: JsonPath): unknown {
    let current = root as any;
    for (const segment of path) {
        current = current?.[segment as any];
    }
    return current;
}

function setAtPath(root: unknown, path: JsonPath, value: number) {
    let current = root as any;
    for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i] as any];
    }
    current[path[path.length - 1] as any] = value;
}

function jsonEquals(a: unknown, b: unknown) {
    return JSON.stringify(a) === JSON.stringify(b);
}

function decodePointerSegment(segment: string) {
    return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function pointerToPath(root: unknown, pointer: string): JsonPath | undefined {
    if (!pointer.startsWith("/")) return undefined;
    const path: JsonPath = [];
    let current = root as any;
    for (const rawSegment of pointer.slice(1).split("/")) {
        const decoded = decodePointerSegment(rawSegment);
        const segment: string | number = Array.isArray(current) ? Number(decoded) : decoded;
        if (Array.isArray(current) && (typeof segment !== "number" || !Number.isInteger(segment) || segment < 0 || segment >= current.length)) {
            return undefined;
        }
        if (!Array.isArray(current) && (!current || typeof current !== "object" || !(decoded in current))) {
            return undefined;
        }
        path.push(segment);
        current = current[segment as any];
    }
    return path;
}

function normalizePresetOverride(value: unknown): PresetOverride | undefined {
    if (!isRecord(value)) return undefined;
    const kind = stringValue(value.kind) as PrismTuningKind | undefined;
    const resource = stringValue(value.resource);
    const pointer = stringValue(value.pointer);
    const numericValue = typeof value.value === "number" && Number.isFinite(value.value) ? value.value : undefined;
    if ((kind !== "density_function" && kind !== "noise") || !resource || !pointer || numericValue === undefined) return undefined;
    return { kind, resource, pointer, value: numericValue };
}

function normalizePreset(value: unknown): PrismLabPreset | undefined {
    if (!isRecord(value)) return undefined;
    const id = stringValue(value.id);
    const name = stringValue(value.name);
    const group = stringValue(value.group) ?? "Presets";
    const description = stringValue(value.description) ?? "";
    const overrides = Array.isArray(value.overrides)
        ? value.overrides.map(normalizePresetOverride).filter((entry): entry is PresetOverride => Boolean(entry))
        : [];
    if (!id || !name || overrides.length === 0) return undefined;
    return { id, name, group, description, overrides };
}

function resourceFromOverride(override: PresetOverride): PrismTuningResource {
    const id = Identifier.parse(override.resource);
    return {
        category: id.namespace,
        kind: override.kind,
        id: override.resource,
        title: resourceTitle(id)
    };
}

function presetMixerGroup(preset: PrismLabPreset): string {
    if (preset.group !== "Rivers") return preset.group;
    const id = preset.id.toLowerCase();
    const text = `${preset.name} ${preset.description}`.toLowerCase();
    if (id.includes("denser") || id.includes("sparser") || text.includes("network") || text.includes("spacing")) {
        return "River frequency";
    }
    if (id.includes("wider") || id.includes("narrower") || text.includes("wide") || text.includes("narrow")) {
        return "River width";
    }
    if (id.includes("deeper") || id.includes("canyon") || id.includes("shallower") || text.includes("deep") || text.includes("shallow")) {
        return "River depth";
    }
    return "Rivers";
}

export const usePrismTuningStore = defineStore("prism_tuning", () => {
    const resources = reactive<PrismTuningResource[]>([]);
    const changedResourceKeys = reactive(new Set<string>());
    const changedSettingKeys = reactive(new Set<string>());
    const resourceAliases = reactive<Record<string, string>>(readStoredRecord<Record<string, string>>(resourceAliasStorageKey));
    const settingAliases = reactive<Record<string, string>>(readStoredRecord<Record<string, string>>(settingAliasStorageKey));
    const settingAliasMetadata = reactive<Record<string, SettingAliasMetadata>>(readStoredRecord<Record<string, SettingAliasMetadata>>(settingMetadataStorageKey));
    const loaded = ref<LoadedResource | undefined>();
    const selectedId = ref<string | undefined>();
    const loading = ref(false);
    const error = ref<string | undefined>();
    const presetGroups = ref<string[]>([]);
    const presets = ref<PrismLabPreset[]>([]);
    const activePresetIdsByGroup = reactive<Record<string, string>>({});
    const presetStatus = ref<string | undefined>();
    const presetWarnings = ref<string[]>([]);

    const tree = computed<PrismTuningTreeCategory[]>(() => {
        const categories = new Map<string, PrismTuningTreeCategory>();
        for (const resource of resources) {
            const category = categories.get(resource.category) ?? {
                id: resource.category,
                title: categoryTitle(resource.category),
                kinds: {
                    density_function: [],
                    noise: []
                }
            };
            category.kinds[resource.kind].push(resource);
            categories.set(resource.category, category);
        }
        return Array.from(categories.values())
            .map(category => ({
                ...category,
                kinds: {
                    density_function: [...category.kinds.density_function].sort((a, b) => a.title.localeCompare(b.title)),
                    noise: [...category.kinds.noise].sort((a, b) => a.title.localeCompare(b.title))
                }
            }))
            .sort((a, b) => a.title.localeCompare(b.title));
    });

    const namedResourceCount = computed(() => Object.values(resourceAliases).filter(Boolean).length);
    const namedSettingCount = computed(() => Object.values(settingAliases).filter(Boolean).length);
    const groupedPresets = computed(() => {
        const inferredGroups = Array.from(new Set(presets.value.map(presetMixerGroup)));
        const orderedGroups = presetGroups.value.length
            ? Array.from(new Set([...presetGroups.value.flatMap(group => group === "Rivers" ? ["River depth", "River width", "River frequency", "Rivers"] : [group]), ...inferredGroups]))
            : inferredGroups;
        return orderedGroups
            .map(group => ({
                group,
                activePresetId: activePresetIdsByGroup[group] ?? "",
                activePreset: presets.value.find(preset => preset.id === activePresetIdsByGroup[group]),
                presets: presets.value.filter(preset => presetMixerGroup(preset) === group)
            }))
            .filter(entry => entry.presets.length > 0);
    });
    const activePresets = computed(() => groupedPresets.value
        .map(group => presets.value.find(preset => preset.id === activePresetIdsByGroup[group.group]))
        .filter((preset): preset is PrismLabPreset => Boolean(preset)));
    const hasActiveNonThemePresets = computed(() => activePresets.value.some(preset => presetMixerGroup(preset) !== "Themes"));

    async function refreshResources() {
        const datapackStore = useDatapackStore();
        const next: PrismTuningResource[] = [];

        const noises = await datapackStore.composite_datapack.getIds(ResourceLocation.WORLDGEN_NOISE);
        next.push(...noises
            .filter(id => id.namespace !== "minecraft")
            .map(id => ({ category: id.namespace, kind: "noise" as const, id: id.toString(), title: resourceTitle(id) })));

        const densityFunctions = await datapackStore.composite_datapack.getIds(ResourceLocation.WORLDGEN_DENSITY_FUNCTION);
        next.push(...densityFunctions
            .filter(id => id.namespace !== "minecraft")
            .map(id => ({ category: id.namespace, kind: "density_function" as const, id: id.toString(), title: resourceTitle(id) })));

        const unique = Array.from(new Map(next.map(resource => [resourceKey(resource), resource])).values());
        resources.splice(0, resources.length, ...unique.sort((a, b) => `${a.category}/${a.kind}/${a.title}`.localeCompare(`${b.category}/${b.kind}/${b.title}`)));
    }

    async function loadResource(resource: PrismTuningResource) {
        const datapackStore = useDatapackStore();
        loading.value = true;
        error.value = undefined;
        selectedId.value = `${resource.kind}:${resource.id}`;
        try {
            const location = resourceLocations[resource.kind];
            const id = Identifier.parse(resource.id);
            const data = await datapackStore.baseline_composite_datapack.get(location, id);
            const override = prismTuningDatapack.getOverride(location, id);
            const working = cloneJson(override ?? data);
            loaded.value = {
                resource,
                original: cloneJson(data),
                working,
                settings: sortSettings(collectNumbers(working, [], [], data))
            };
            registerSettingMetadata(resource, loaded.value.settings);
        } catch (e) {
            error.value = e instanceof Error ? e.message : String(e);
        } finally {
            loading.value = false;
        }
    }

    function applyNumber(setting: NumericSetting, rawValue: number | string) {
        if (!loaded.value) return;
        const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue);
        if (!Number.isFinite(numericValue)) return;

        setAtPath(loaded.value.working, setting.path, numericValue);
        const liveValue = getAtPath(loaded.value.working, setting.path);
        setting.value = typeof liveValue === "number" ? liveValue : numericValue;
        registerSettingMetadata(loaded.value.resource, loaded.value.settings);

        const location = resourceLocations[loaded.value.resource.kind];
        const id = Identifier.parse(loaded.value.resource.id);
        prismTuningDatapack.setOverride(location, id, loaded.value.working);
        registerRuntimeResource(loaded.value.resource, loaded.value.working);
        changedResourceKeys.add(resourceAliasKey(loaded.value.resource));
        changedSettingKeys.add(settingAliasKey(loaded.value.resource, setting.key));

        const datapackStore = useDatapackStore();
        datapackStore.notifyTuningChanged();
    }

    function resetLoadedResource() {
        if (!loaded.value) return;
        const working = cloneJson(loaded.value.original);
        const settings = sortSettings(collectNumbers(working, [], [], loaded.value.original));
        const location = resourceLocations[loaded.value.resource.kind];
        const id = Identifier.parse(loaded.value.resource.id);
        prismTuningDatapack.clearOverride(location, id);
        registerRuntimeResource(loaded.value.resource, loaded.value.original);
        const resourceKey = resourceAliasKey(loaded.value.resource);
        changedResourceKeys.delete(resourceKey);
        for (const key of Array.from(changedSettingKeys)) {
            if (key.startsWith(`${resourceKey}#`)) {
                changedSettingKeys.delete(key);
            }
        }
        loaded.value = {
            ...loaded.value,
            working,
            settings
        };
        registerSettingMetadata(loaded.value.resource, loaded.value.settings);
        const datapackStore = useDatapackStore();
        datapackStore.notifyTuningChanged();
    }

    function loadPresetPayload(payload: unknown): { presets: number, groups: number } {
        if (!isRecord(payload) || payload.schema !== "prism-worldgen-lab.presets.v1") {
            throw new Error("Preset file must use schema prism-worldgen-lab.presets.v1.");
        }
        const pack = payload as PresetPack;
        const nextPresets = Array.isArray(pack.presets)
            ? pack.presets.map(normalizePreset).filter((preset): preset is PrismLabPreset => Boolean(preset))
            : [];
        if (nextPresets.length === 0) {
            throw new Error("Preset file did not contain any usable presets.");
        }
        const explicitGroups = Array.isArray(pack.groups)
            ? pack.groups.map(group => typeof group === "string" ? group.trim() : "").filter(Boolean)
            : [];
        const missingGroups = nextPresets.map(preset => preset.group).filter(group => !explicitGroups.includes(group));
        presetGroups.value = Array.from(new Set([...explicitGroups, ...missingGroups]));
        presets.value = nextPresets;
        for (const group of Object.keys(activePresetIdsByGroup)) {
            delete activePresetIdsByGroup[group];
        }
        presetWarnings.value = [];
        presetStatus.value = `Loaded ${nextPresets.length} presets.`;
        return { presets: nextPresets.length, groups: presetGroups.value.length };
    }

    async function loadBundledPresets() {
        const response = await fetch(bundledPresetPackUrl);
        if (!response.ok) {
            throw new Error(`Bundled preset pack could not be loaded (${response.status}).`);
        }
        return loadPresetPayload(await response.json());
    }

    async function loadBundledAnnotations() {
        const response = await fetch(bundledAnnotationPackUrl);
        if (!response.ok) {
            throw new Error(`Bundled annotations could not be loaded (${response.status}).`);
        }
        return importAnnotationPayload(await response.json(), false);
    }

    async function importPresetsFromFile(file: File): Promise<{ presets: number, groups: number }> {
        const payload = JSON.parse(await file.text());
        return loadPresetPayload(payload);
    }

    async function resetPresetDefaults() {
        for (const group of Object.keys(activePresetIdsByGroup)) {
            delete activePresetIdsByGroup[group];
        }
        await applyPresetConfiguration();
    }

    async function selectPresetForGroup(group: string, presetId: string) {
        if (presetId) {
            activePresetIdsByGroup[group] = presetId;
        } else {
            delete activePresetIdsByGroup[group];
        }
        return applyPresetConfiguration();
    }

    async function applyPreset(presetId: string) {
        const preset = presets.value.find(entry => entry.id === presetId);
        if (!preset) {
            await resetPresetDefaults();
            return { applied: 0, skipped: 0, warnings: presetWarnings.value, appliedKeys: [] };
        }
        return selectPresetForGroup(preset.group, preset.id);
    }

    async function applyPresetConfiguration() {
        const datapackStore = useDatapackStore();
        const selectedPresets = activePresets.value;
        const presetPointerUnion = new Map<string, { resource: PrismTuningResource, overrides: PresetOverride[] }>();
        const warnings: string[] = [];

        for (const preset of presets.value) {
            for (const override of preset.overrides) {
                const resource = resourceFromOverride(override);
                const key = resourceAliasKey(resource);
                const entry = presetPointerUnion.get(key) ?? { resource, overrides: [] };
                if (!entry.overrides.some(existing => existing.pointer === override.pointer)) {
                    entry.overrides.push(override);
                }
                presetPointerUnion.set(key, entry);
            }
        }

        const appliedKeys = new Set<string>();
        let applied = 0;
        let skipped = 0;

        for (const { resource, overrides: unionOverrides } of presetPointerUnion.values()) {
            const location = resourceLocations[resource.kind];
            const id = Identifier.parse(resource.id);
            let original: unknown;
            try {
                original = await datapackStore.baseline_composite_datapack.get(location, id);
            } catch {
                skipped += unionOverrides.length;
                warnings.push(`Missing resource ${resource.kind}:${resource.id}.`);
                continue;
            }

            const working = cloneJson(prismTuningDatapack.getOverride(location, id) ?? original);
            const base = cloneJson(original);
            const resourceAlias = resourceAliasKey(resource);

            for (const override of unionOverrides) {
                const basePath = pointerToPath(base, override.pointer);
                const workingPath = pointerToPath(working, override.pointer);
                const settingKeyValue = override.pointer.slice(1);
                changedSettingKeys.delete(settingAliasKey(resource, settingKeyValue));
                if (!basePath || !workingPath) {
                    skipped++;
                    warnings.push(`Skipped reset ${resource.kind}:${resource.id}#${override.pointer}: pointer not found.`);
                    continue;
                }
                const defaultValue = getAtPath(base, basePath);
                if (typeof defaultValue !== "number" || !Number.isFinite(defaultValue)) {
                    skipped++;
                    warnings.push(`Skipped reset ${resource.kind}:${resource.id}#${override.pointer}: default is not numeric.`);
                    continue;
                }
                setAtPath(working, workingPath, defaultValue);
            }

            for (const preset of selectedPresets) {
                for (const override of preset.overrides.filter(entry => entry.kind === resource.kind && entry.resource === resource.id)) {
                    const path = pointerToPath(working, override.pointer);
                    if (!path) {
                        skipped++;
                        warnings.push(`Skipped apply ${resource.kind}:${resource.id}#${override.pointer}: pointer not found.`);
                        continue;
                    }
                    setAtPath(working, path, override.value);
                    const settingKeyValue = override.pointer.slice(1);
                    const fullSettingKey = settingAliasKey(resource, settingKeyValue);
                    changedSettingKeys.add(fullSettingKey);
                    appliedKeys.add(fullSettingKey);
                    applied++;
                }
            }

            if (jsonEquals(working, base)) {
                prismTuningDatapack.clearOverride(location, id);
                registerRuntimeResource(resource, base);
            } else {
                prismTuningDatapack.setOverride(location, id, working);
                registerRuntimeResource(resource, working);
            }

            if (Array.from(changedSettingKeys).some(key => key.startsWith(`${resourceAlias}#`))) {
                changedResourceKeys.add(resourceAlias);
            } else {
                changedResourceKeys.delete(resourceAlias);
            }

            if (loaded.value && resourceAliasKey(loaded.value.resource) === resourceAlias) {
                loaded.value = {
                    resource,
                    original: cloneJson(base),
                    working: cloneJson(working),
                    settings: sortSettings(collectNumbers(working, [], [], base))
                };
                registerSettingMetadata(resource, loaded.value.settings);
            }
        }

        presetWarnings.value = warnings;
        const activeNames = selectedPresets.map(preset => preset.name).join(" + ");
        presetStatus.value = selectedPresets.length
            ? `${activeNames} - ${applied} leaf${applied === 1 ? "" : "s"} set${skipped ? `, ${skipped} skipped` : ""}.`
            : `Preset defaults restored${skipped ? `, ${skipped} skipped` : ""}.`;

        datapackStore.notifyTuningChanged();
        return { applied, skipped, warnings, appliedKeys: Array.from(appliedKeys) };
    }

    function isResourceChanged(resource: PrismTuningResource): boolean {
        return changedResourceKeys.has(resourceAliasKey(resource));
    }

    function isSettingChanged(setting: NumericSetting): boolean {
        if (!loaded.value) return false;
        return changedSettingKeys.has(settingAliasKey(loaded.value.resource, setting.key));
    }

    function registerSettingMetadata(resource: PrismTuningResource, settings: NumericSetting[]) {
        const resourceKey = resourceAliasKey(resource);
        for (const setting of settings) {
            const key = settingAliasKey(resource, setting.key);
            settingAliasMetadata[key] = {
                resourceKey,
                category: resource.category,
                kind: resource.kind,
                resourceId: resource.id,
                resourceTitle: resource.title,
                settingKey: setting.key,
                label: setting.label,
                path: [...setting.path],
                jsonPointer: pathToJsonPointer(setting.path),
                lastValue: setting.value
            };
        }
        writeStoredRecord(settingMetadataStorageKey, settingAliasMetadata);
    }

    function getResourceAlias(resource: PrismTuningResource): string {
        return resourceAliases[resourceAliasKey(resource)] ?? "";
    }

    function getResourceDisplayName(resource: PrismTuningResource): string {
        return getResourceAlias(resource) || resource.title;
    }

    function setResourceAlias(resource: PrismTuningResource, value: string) {
        const key = resourceAliasKey(resource);
        const trimmed = value.trim();
        if (trimmed) {
            resourceAliases[key] = value;
        } else {
            delete resourceAliases[key];
        }
        writeStoredRecord(resourceAliasStorageKey, resourceAliases);
    }

    function getSettingAlias(setting: NumericSetting): string {
        if (!loaded.value) return "";
        return settingAliases[settingAliasKey(loaded.value.resource, setting.key)] ?? "";
    }

    function getSettingDisplayLabel(setting: NumericSetting): string {
        return getSettingAlias(setting) || setting.label;
    }

    function setSettingAlias(setting: NumericSetting, value: string) {
        if (!loaded.value) return;
        const key = settingAliasKey(loaded.value.resource, setting.key);
        const trimmed = value.trim();
        if (trimmed) {
            settingAliases[key] = value;
        } else {
            delete settingAliases[key];
        }
        registerSettingMetadata(loaded.value.resource, loaded.value.settings);
        writeStoredRecord(settingAliasStorageKey, settingAliases);
    }

    function buildAnnotationExport() {
        const namedResources = Object.entries(resourceAliases)
            .filter(([, alias]) => Boolean(alias))
            .map(([key, alias]) => {
                const resource = resources.find(r => resourceAliasKey(r) === key);
                return {
                    name: alias,
                    key,
                    category: resource?.category,
                    kind: resource?.kind ?? key.split(":", 1)[0],
                    id: resource?.id ?? key.substring(key.indexOf(":") + 1),
                    title: resource?.title
                };
            });

        const namedSettings = Object.entries(settingAliases)
            .filter(([, alias]) => Boolean(alias))
            .map(([key, alias]) => {
                const metadata = settingAliasMetadata[key];
                return {
                    name: alias,
                    key,
                    resourceName: metadata ? resourceAliases[metadata.resourceKey] ?? "" : "",
                    category: metadata?.category,
                    kind: metadata?.kind,
                    resourceId: metadata?.resourceId,
                    resourceTitle: metadata?.resourceTitle,
                    settingKey: metadata?.settingKey ?? key.split("#")[1] ?? "",
                    settingLabel: metadata?.label,
                    path: metadata?.path,
                    jsonPointer: metadata?.jsonPointer,
                    lastSeenValue: metadata?.lastValue
                };
            });

        return {
            schema: "prism-worldgen-lab.annotations.v1",
            exportedAt: new Date().toISOString(),
            summary: {
                namedResources: namedResources.length,
                namedSettings: namedSettings.length
            },
            namedResources,
            namedSettings
        };
    }

    function exportAnnotations() {
        const payload = buildAnnotationExport();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const stamp = safeFileStamp();
        link.href = url;
        link.download = `prism-worldgen-lab-annotations-${stamp}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function importAnnotationPayload(payload: unknown, persist = true): { resources: number, settings: number } {
        if (!isRecord(payload)) {
            throw new Error("Annotation file must contain a JSON object.");
        }

        const importedResources = Array.isArray(payload.namedResources) ? payload.namedResources : [];
        const importedSettings = Array.isArray(payload.namedSettings) ? payload.namedSettings : [];
        let resourceCount = 0;
        let settingCount = 0;

        for (const entry of importedResources) {
            if (!isRecord(entry)) continue;
            const name = stringValue(entry.name);
            const key = stringValue(entry.key);
            const kind = stringValue(entry.kind);
            const id = stringValue(entry.id) ?? stringValue(entry.resourceId);
            const resolvedKey = key ?? (kind && id ? `${kind}:${id}` : undefined);
            if (!name || !resolvedKey) continue;
            resourceAliases[resolvedKey] = name;
            resourceCount++;
        }

        for (const entry of importedSettings) {
            if (!isRecord(entry)) continue;
            const name = stringValue(entry.name);
            const key = stringValue(entry.key);
            const kind = stringValue(entry.kind);
            const resourceId = stringValue(entry.resourceId) ?? stringValue(entry.id);
            const settingKeyValue = stringValue(entry.settingKey);
            const resolvedKey = key ?? (kind && resourceId && settingKeyValue ? `${kind}:${resourceId}#${settingKeyValue}` : undefined);
            if (!name || !resolvedKey) continue;
            settingAliases[resolvedKey] = name;

            const existingMetadata = settingAliasMetadata[resolvedKey];
            settingAliasMetadata[resolvedKey] = {
                resourceKey: stringValue(entry.resourceKey) ?? existingMetadata?.resourceKey ?? (kind && resourceId ? `${kind}:${resourceId}` : ""),
                category: (stringValue(entry.category) as PrismTuningCategoryId | undefined) ?? existingMetadata?.category ?? "lithosphere",
                kind: (kind as PrismTuningKind | undefined) ?? existingMetadata?.kind ?? "noise",
                resourceId: resourceId ?? existingMetadata?.resourceId ?? "",
                resourceTitle: stringValue(entry.resourceTitle) ?? existingMetadata?.resourceTitle ?? "",
                settingKey: settingKeyValue ?? existingMetadata?.settingKey ?? resolvedKey.split("#")[1] ?? "",
                label: stringValue(entry.settingLabel) ?? stringValue(entry.label) ?? existingMetadata?.label ?? settingKeyValue ?? "",
                path: Array.isArray(entry.path) ? entry.path as JsonPath : existingMetadata?.path ?? [],
                jsonPointer: stringValue(entry.jsonPointer) ?? existingMetadata?.jsonPointer ?? "",
                lastValue: typeof entry.lastSeenValue === "number" ? entry.lastSeenValue : existingMetadata?.lastValue ?? 0
            };
            settingCount++;
        }

        if (persist) {
            writeStoredRecord(resourceAliasStorageKey, resourceAliases);
            writeStoredRecord(settingAliasStorageKey, settingAliases);
            writeStoredRecord(settingMetadataStorageKey, settingAliasMetadata);
        }
        return { resources: resourceCount, settings: settingCount };
    }

    async function importAnnotationsFromFile(file: File): Promise<{ resources: number, settings: number }> {
        const text = await file.text();
        const payload = JSON.parse(text);
        const result = importAnnotationPayload(payload);
        if (loaded.value) {
            registerSettingMetadata(loaded.value.resource, loaded.value.settings);
        }
        return result;
    }

    async function exportDatapack() {
        const settingsStore = useSettingsStore();
        const overrides = prismTuningDatapack.listOverrides();
        const zip = new JSZip();
        const packFormat = versionMetadata[settingsStore.mc_version].datapackFormat;
        const manifest = {
            schema: "prism-worldgen-lab.datapack-export.v1",
            exportedAt: new Date().toISOString(),
            minecraftVersion: settingsStore.mc_version,
            note: "Contains only PRISM Worldgen Lab tuning overrides. Load above the Lithosphere/Still Life mods for in-game testing.",
            files: overrides.map(entry => ({
                id: entry.id.toString(),
                location: `${entry.location.type}:${entry.location.location}`,
                path: resourceFilePath(entry.location, entry.id)
            })),
            annotations: buildAnnotationExport()
        };

        zip.file("pack.mcmeta", JSON.stringify({
            pack: {
                pack_format: packFormat.major,
                description: "PRISM Worldgen Lab tuning export"
            }
        }, null, 2));
        zip.file("prism_lab_export_manifest.json", JSON.stringify(manifest, null, 2));

        for (const entry of overrides) {
            if (entry.data instanceof ArrayBuffer) continue;
            zip.file(resourceFilePath(entry.location, entry.id), JSON.stringify(entry.data, null, 2));
        }

        const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
        const fileName = `prism-worldgen-lab-tuning-${safeFileStamp()}.zip`;
        const savedPath = await saveBlobViaDesktopApp(blob, fileName);
        if (savedPath) {
            presetStatus.value = `Datapack export saved: ${savedPath}`;
        } else {
            downloadBlob(blob, fileName);
        }
    }

    function buildCurrentPresetPack(name: string, group: string) {
        const overrides: PresetExportOverride[] = [];
        for (const entry of prismTuningDatapack.listOverrides()) {
            if (entry.data instanceof ArrayBuffer) continue;
            const resource: PrismTuningResource = {
                category: entry.id.namespace === "still_life" ? "still_life" : "lithosphere",
                kind: entry.location.type === ResourceLocation.WORLDGEN_NOISE.type && entry.location.location === ResourceLocation.WORLDGEN_NOISE.location ? "noise" : "density_function",
                id: entry.id.toString(),
                title: resourceTitle(entry.id)
            };
            const baseSettings = collectNumbers(entry.data);
            for (const setting of baseSettings) {
                const key = settingAliasKey(resource, setting.key);
                overrides.push({
                    kind: resource.kind,
                    resource: resource.id,
                    pointer: pathToJsonPointer(setting.path),
                    value: setting.value,
                    label: settingAliases[key] || setting.label
                });
            }
        }

        return {
            schema: "prism-worldgen-lab.presets.v1",
            version: 1,
            generatedAt: new Date().toISOString(),
            appliesTo: "Lithosphere 1.6 / Minecraft 1.21.1 - PRISM Worldgen Lab custom preset",
            note: "Generated from the current PRISM Worldgen Lab tuning state. Presets are intended for Lithosphere 1.6; Still Life tuning is not actively curated.",
            groups: [group],
            presets: [{
                id: `custom-${safeFileNamePart(name).toLowerCase()}-${safeFileStamp()}`,
                name,
                group,
                description: "Custom user preset generated from current tuning values.",
                overrides
            }]
        };
    }

    function exportCurrentTuningAsPreset(name: string, group: string) {
        const pack = buildCurrentPresetPack(name, group);
        const overrideCount = pack.presets[0].overrides.length;
        if (overrideCount === 0) {
            throw new Error("No modified tuning values are available to save as a preset.");
        }
        const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json" });
        downloadBlob(blob, `prism-worldgen-lab-preset-${safeFileNamePart(name)}-${safeFileStamp()}.json`);
        presetStatus.value = `Preset pack exported: ${name}`;
    }

    return {
        resources,
        tree,
        namedResourceCount,
        namedSettingCount,
        presetGroups,
        presets,
        groupedPresets,
        activePresets,
        activePresetIdsByGroup,
        hasActiveNonThemePresets,
        presetStatus,
        presetWarnings,
        loaded,
        selectedId,
        loading,
        error,
        refreshResources,
        loadResource,
        applyNumber,
        resetLoadedResource,
        loadBundledPresets,
        loadBundledAnnotations,
        importPresetsFromFile,
        applyPreset,
        selectPresetForGroup,
        resetPresetDefaults,
        isResourceChanged,
        isSettingChanged,
        getResourceDisplayName,
        getSettingDisplayLabel,
        exportDatapack,
        exportCurrentTuningAsPreset
    };
});
