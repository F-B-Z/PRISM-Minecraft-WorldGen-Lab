/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;
export { };

import { Climate, DensityFunction, WorldgenRegistries, Identifier, Holder, NoiseGeneratorSettings, RandomState, NoiseParameters, BiomeSource } from "deepslate"
import { parseDensityFunctionWithMdfMode, withMdfDensityFunctionParser } from "../util/moreDensityFunctions.js"

type CaveViewMode = "off" | "layered" | "full"

class MultiNoiseCalculator {

	private state: {
		sampler?: Climate.Sampler,
		biomeSource?: BiomeSource,
		surfaceDensityFunction?: DensityFunction,
		terrainDensityFunction?: DensityFunction,
		noiseGeneratorSettings?: NoiseGeneratorSettings
		randomState?: RandomState
		levelMaxY?: number
		levelMinY?: number
		y: number,
		seed: bigint,
		projectDown: boolean
		surfaceBiomes: boolean
		caveView: CaveViewMode
		generationVersion: number
		mdfMode: boolean
	} = {
		y: 0,
		seed: BigInt(0),
		generationVersion: -1,
		projectDown: true,
		surfaceBiomes: true,
		caveView: "off",
		mdfMode: false
	}

	private taskQueue: any[] = []

	public update(update: {
		biomeSourceJson?: unknown,
		noiseGeneratorSettingsJson?: unknown,
		densityFunctions?: { [key: string]: unknown },
		noises?: { [key: string]: unknown },
		surfaceDensityFunctionId?: string,
		terrainDensityFunctionId?: string,
		generationVersion?: number
		levelMaxY?: number
		levelMinY?: number

		seed?: bigint,
		y?: number,
		project_down: boolean
		surface_biomes?: boolean
		cave_view?: CaveViewMode
		mdfMode?: boolean
	}) {
		this.state.seed = update.seed ?? this.state.seed
		this.state.y = update.y ?? this.state.y
		this.state.projectDown = update.project_down ?? this.state.projectDown
		this.state.surfaceBiomes = update.surface_biomes ?? this.state.surfaceBiomes
		this.state.caveView = update.cave_view ?? this.state.caveView
		this.state.generationVersion = update.generationVersion ?? this.state.generationVersion
		this.state.levelMaxY = update.levelMaxY ?? this.state.levelMaxY
		this.state.levelMinY = update.levelMinY ?? this.state.levelMinY
		this.state.mdfMode = update.mdfMode ?? this.state.mdfMode

		if (update.biomeSourceJson) {
			this.state.biomeSource = BiomeSource.fromJson(update.biomeSourceJson)
		}


		if (update.densityFunctions) {
			WorldgenRegistries.DENSITY_FUNCTION.clear()
			for (const id in update.densityFunctions) {
				const df = new DensityFunction.HolderHolder(Holder.parser(WorldgenRegistries.DENSITY_FUNCTION, obj => parseDensityFunctionWithMdfMode(obj, this.state.mdfMode))(update.densityFunctions[id]))
				WorldgenRegistries.DENSITY_FUNCTION.register(Identifier.parse(id), df)
			}
		}

		if (update.noises) {
			WorldgenRegistries.NOISE.clear()
			for (const id in update.noises) {
				const noise = NoiseParameters.fromJson(update.noises[id])
				WorldgenRegistries.NOISE.register(Identifier.parse(id), noise)
			}
		}

		if (update.noiseGeneratorSettingsJson) {
			this.state.noiseGeneratorSettings = withMdfDensityFunctionParser(
				this.state.mdfMode,
				() => NoiseGeneratorSettings.fromJson(update.noiseGeneratorSettingsJson)
			)
			this.state.randomState = new RandomState(this.state.noiseGeneratorSettings, this.state.seed)
			this.state.sampler = Climate.Sampler.fromRouter(this.state.randomState.router)
		}

		if (this.state.randomState && this.state.noiseGeneratorSettings) {
			if (update.surfaceDensityFunctionId === "<none>"){
				this.state.surfaceDensityFunction = undefined
			} else if (update.surfaceDensityFunctionId) {
				this.state.surfaceDensityFunction = new DensityFunction.HolderHolder(
					Holder.reference(
						WorldgenRegistries.DENSITY_FUNCTION,
						Identifier.parse(update.surfaceDensityFunctionId)
					)).mapAll(this.state.randomState.createVisitor(this.state.noiseGeneratorSettings.noise, this.state.noiseGeneratorSettings.legacyRandomSource))
			}

			if (update.terrainDensityFunctionId === "<none>"){
				this.state.terrainDensityFunction = undefined
			} else if (update.terrainDensityFunctionId) {
				this.state.terrainDensityFunction = new DensityFunction.HolderHolder(
					Holder.reference(
						WorldgenRegistries.DENSITY_FUNCTION,
						Identifier.parse(update.terrainDensityFunctionId)
					)).mapAll(this.state.randomState.createVisitor(this.state.noiseGeneratorSettings.noise, this.state.noiseGeneratorSettings.legacyRandomSource))
			}
			
		}

		this.taskQueue = []
	}

	private findTopSolid(finalDensity: DensityFunction, blockX: number, blockZ: number, upper: number, lower: number): number | undefined {
		for (let blockY = upper; blockY >= lower; blockY -= 4) {
			if (finalDensity.compute(DensityFunction.context(blockX, blockY, blockZ)) > 0) {
				const refineUpper = Math.min(upper, blockY + 3)
				const refineLower = Math.max(lower, blockY - 3)
				for (let refineY = refineUpper; refineY >= refineLower; refineY--) {
					if (finalDensity.compute(DensityFunction.context(blockX, refineY, blockZ)) > 0) {
						return refineY
					}
				}
				return blockY
			}
		}
		return undefined
	}

	private computeSurface(quartX: number, quartZ: number): number {
		const blockX = quartX * 4
		const blockZ = quartZ * 4
		const estimate = this.state.surfaceDensityFunction?.compute(DensityFunction.context(blockX, this.state.y, blockZ)) ?? Number.POSITIVE_INFINITY
		const finalDensity = this.state.randomState?.router.finalDensity
		if (finalDensity === undefined) return estimate

		const noise = this.state.noiseGeneratorSettings?.noise
		const minY = this.state.levelMinY ?? noise?.minY ?? -64
		const maxY = (this.state.levelMaxY ?? (noise ? noise.minY + noise.height : 512)) - 1
		const searchUp = 48
		const searchDown = 96
		const upper = Number.isFinite(estimate) ? Math.min(maxY, Math.ceil(estimate) + searchUp) : maxY
		const lower = Number.isFinite(estimate) ? Math.max(minY, Math.floor(estimate) - searchDown) : minY
		const localTop = this.findTopSolid(finalDensity, blockX, blockZ, upper, lower)
		if (localTop !== undefined) return localTop

		if (Number.isFinite(estimate)) {
			const fullTop = this.findTopSolid(finalDensity, blockX, blockZ, maxY, minY)
			if (fullTop !== undefined) return fullTop
			return estimate
		}

		return Number.POSITIVE_INFINITY
	}

	public addTask(task: any){
		this.taskQueue.push(task)
	}

	public removeTask(key: string){
		const index = this.taskQueue.findIndex((task) => task.key === key)
		if (index >= 0){
			this.taskQueue.splice(index, 1)
		}
	}

	public async loop() {
		while (true) {
			if (this.taskQueue.length === 0) {
				await new Promise(r => setTimeout(r, 1000));
			} else {
				const nextTaks = this.taskQueue.shift()
				this.calculateMultiNoiseValues(nextTaks.key, nextTaks.min.x, nextTaks.min.y, nextTaks.max.x, nextTaks.max.y, nextTaks.tileSize)
				await new Promise(r => setTimeout(r, 0));
			}
		}
	}

	private calculateMultiNoiseValues(key: string, min_x: number, min_z: number, max_x: number, max_z: number, tileSize: number): void {
		const array: { surface: number, biome: string, terrain: number }[][] = Array(tileSize + 2)
		const step = (max_x - min_x) / tileSize
		const surfaceSampler = this.state.sampler
			? {
				sample: (x: number, y: number, z: number) => {
					const climate = this.state.sampler!.sample(x, y, z)
					return Climate.target(climate.temperature, climate.humidity, climate.continentalness, climate.erosion, 0, climate.weirdness)
				}
			} as Climate.Sampler
			: undefined
		for (let ix = -1; ix < tileSize + 2; ix++) {
			array[ix] = Array(tileSize + 2)
			for (let iz = -1; iz < tileSize + 2; iz++) {
				const x = ix * step + min_x
				const z = iz * step + min_z
				const surface = this.computeSurface(x, z)
				const y = this.state.caveView !== "off" ? this.state.y : this.state.projectDown ? Math.min(surface, this.state.y) : this.state.y
				const useSurfaceBiomeLayer = this.state.caveView === "off" && this.state.projectDown && this.state.surfaceBiomes
				const biomeSampler = useSurfaceBiomeLayer ? surfaceSampler : this.state.sampler
				const biomeY = useSurfaceBiomeLayer && Number.isFinite(surface)
					? Math.min(surface + 4, this.state.levelMaxY ? this.state.levelMaxY - 1 : surface + 4)
					: y
				const biome = this.state.biomeSource?.getBiome(x, biomeY >> 2, z, biomeSampler!).toString() ?? "minecraft:plains"
				const terrain = this.state.terrainDensityFunction?.compute(DensityFunction.context(x * 4, y , z * 4)) ?? Number.POSITIVE_INFINITY
				array[ix][iz] = { surface, biome, terrain }
			}
		}

		postMessage({ key, array, step, generationVersion: this.state.generationVersion })
	}
}


const multiNoiseCalculator = new MultiNoiseCalculator()
multiNoiseCalculator.loop()

self.onmessage = (evt: ExtendableMessageEvent) => {
	if ("update" in evt.data){
		multiNoiseCalculator.update(evt.data.update)
	} else if ("task" in evt.data){
		multiNoiseCalculator.addTask(evt.data.task)
	} else if ("cancel" in evt.data){
		multiNoiseCalculator.removeTask(evt.data.cancel)
	}
}
