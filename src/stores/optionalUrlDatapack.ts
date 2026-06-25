import { AnonymousDatapack, Datapack, PackFormat, ResourceLocation } from "mc-datapack-loader";
import { Identifier } from "deepslate";

export class OptionalUrlDatapack implements AnonymousDatapack {
    private datapackPromise?: Promise<AnonymousDatapack | undefined>;

    constructor(
        private readonly url: string,
        private packFormat: number | PackFormat,
        private readonly label: string
    ) {}

    setPackVersion(packFormat: number | PackFormat) {
        this.packFormat = packFormat;
        this.datapackPromise = undefined;
    }

    private async getDatapack(): Promise<AnonymousDatapack | undefined> {
        this.datapackPromise ??= fetch(this.url)
            .then(async response => {
                if (!response.ok) return undefined;
                const blob = await response.blob();
                const fileName = this.url.split("/").reverse()[0] ?? "datapack.jar";
                return Datapack.fromZipFile(new File([blob], fileName), this.packFormat);
            })
            .catch(error => {
                console.warn(`Optional PRISM reference datapack not loaded (${this.label}):`, error);
                return undefined;
            });
        return this.datapackPromise;
    }

    async has(location: ResourceLocation, id: Identifier): Promise<boolean> {
        return await (await this.getDatapack())?.has(location, id) ?? false;
    }

    async getIds(location: ResourceLocation): Promise<Identifier[]> {
        return await (await this.getDatapack())?.getIds(location) ?? [];
    }

    async get(location: ResourceLocation, id: Identifier): Promise<unknown | ArrayBuffer> {
        const datapack = await this.getDatapack();
        if (!datapack) {
            throw new Error(`Optional PRISM reference datapack missing: ${this.label}`);
        }
        return datapack.get(location, id);
    }

    canSave(): Promise<boolean> {
        return Promise.resolve(false);
    }

    save(): Promise<boolean> {
        return Promise.resolve(false);
    }

    prepareSave(): Promise<void> {
        return Promise.resolve();
    }
}
