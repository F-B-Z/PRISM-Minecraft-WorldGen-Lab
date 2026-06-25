import { AnonymousDatapack, ResourceLocation } from "mc-datapack-loader";
import { Identifier } from "deepslate";

type OverrideEntry = {
    location: ResourceLocation;
    id: Identifier;
    data: unknown | ArrayBuffer;
}

function cloneData<T>(data: T): T {
    if (data instanceof ArrayBuffer) {
        return data.slice(0) as T;
    }
    return JSON.parse(JSON.stringify(data));
}

function overrideKey(location: ResourceLocation, id: Identifier): string {
    return `${location.type}:${location.location}:${id.toString()}`;
}

class PrismTuningDatapack implements AnonymousDatapack {
    private overrides = new Map<string, OverrideEntry>();

    public revision = 0;

    has(location: ResourceLocation, id: Identifier): Promise<boolean> {
        return Promise.resolve(this.overrides.has(overrideKey(location, id)));
    }

    getIds(location: ResourceLocation): Promise<Identifier[]> {
        const ids = Array.from(this.overrides.values())
            .filter(entry => entry.location.type === location.type && entry.location.location === location.location)
            .map(entry => entry.id);
        return Promise.resolve(ids);
    }

    async get(location: ResourceLocation, id: Identifier): Promise<unknown | ArrayBuffer> {
        const entry = this.overrides.get(overrideKey(location, id));
        if (!entry) {
            throw new Error(`Missing PRISM tuning override: ${id.toString()}`);
        }
        return cloneData(entry.data);
    }

    canSave(): Promise<boolean> {
        return Promise.resolve(true);
    }

    async save(location: ResourceLocation, id: Identifier, data: unknown | ArrayBuffer): Promise<boolean> {
        this.setOverride(location, id, data);
        return true;
    }

    prepareSave(): Promise<void> {
        return Promise.resolve();
    }

    setOverride(location: ResourceLocation, id: Identifier, data: unknown | ArrayBuffer) {
        this.overrides.set(overrideKey(location, id), {
            location,
            id,
            data: cloneData(data)
        });
        this.revision++;
    }

    clearOverride(location: ResourceLocation, id: Identifier) {
        if (this.overrides.delete(overrideKey(location, id))) {
            this.revision++;
        }
    }

    clearAll() {
        if (this.overrides.size > 0) {
            this.overrides.clear();
            this.revision++;
        }
    }

    getOverride(location: ResourceLocation, id: Identifier): unknown | ArrayBuffer | undefined {
        const entry = this.overrides.get(overrideKey(location, id));
        return entry ? cloneData(entry.data) : undefined;
    }

    listOverrides(): OverrideEntry[] {
        return Array.from(this.overrides.values()).map(entry => ({
            location: entry.location,
            id: entry.id,
            data: cloneData(entry.data)
        }));
    }
}

export const prismTuningDatapack = new PrismTuningDatapack();
