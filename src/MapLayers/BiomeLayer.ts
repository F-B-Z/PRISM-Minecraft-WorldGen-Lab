import * as L from "leaflet"
//import { last, range, takeWhile } from "lodash";
import { Climate } from "deepslate";
import { calculateHillshade, getCustomDensityFunction, hashCode } from "../util.js";
import MultiNoiseCalculator from "../webworker/MultiNoiseCalculator?worker"
import { useSearchStore } from "../stores/useBiomeSearchStore.js";
import { useLoadedDimensionStore } from "../stores/useLoadedDimensionStore.js";
import { useSettingsStore } from "../stores/useSettingsStore.js";
import { useDatapackStore } from "../stores/useDatapackStore.js";
import { useMdfModeStore } from "../stores/useMdfModeStore.js";
import { prismTuningDatapack } from "../stores/prismTuningDatapack.js";
import { Ref, toRaw, watch } from "vue";
import { ResourceLocation } from "mc-datapack-loader";
import type { AnonymousDatapack } from "mc-datapack-loader";

const WORKER_COUNT = 4

type Rgb = { r: number, g: number, b: number }
export type CaveViewMode = "off" | "layered" | "full"
export type DifferenceFilterMode = "all" | "cliffs" | "mountains" | "peaks" | "coasts" | "ocean" | "caves" | "biomes"
export type DifferenceStats = {
	total: number,
	changed: number,
	changedPercent: number,
	maxDelta: number,
	averageDelta: number,
	clipCount: number
}

const HEIGHT_STOPS: { y: number, color: Rgb }[] = [
	{ y: -64, color: { r: 36, g: 53, b: 70 } },
	{ y: 50, color: { r: 142, g: 158, b: 155 } },
	{ y: 70, color: { r: 188, g: 197, b: 177 } },
	{ y: 96, color: { r: 164, g: 179, b: 135 } },
	{ y: 128, color: { r: 157, g: 139, b: 100 } },
	{ y: 176, color: { r: 128, g: 109, b: 88 } },
	{ y: 240, color: { r: 84, g: 87, b: 94 } },
	{ y: 320, color: { r: 43, g: 46, b: 53 } },
	{ y: 400, color: { r: 12, g: 13, b: 17 } }
]

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value))
}

function lerpChannel(a: number, b: number, t: number) {
	return Math.round(a + (b - a) * t)
}

function heightColor(surface: number): Rgb {
	const y = clamp(surface, HEIGHT_STOPS[0].y, HEIGHT_STOPS[HEIGHT_STOPS.length - 1].y)
	for (let i = 1; i < HEIGHT_STOPS.length; i++) {
		const previous = HEIGHT_STOPS[i - 1]
		const current = HEIGHT_STOPS[i]
		if (y <= current.y) {
			const t = (y - previous.y) / (current.y - previous.y)
			return {
				r: lerpChannel(previous.color.r, current.color.r, t),
				g: lerpChannel(previous.color.g, current.color.g, t),
				b: lerpChannel(previous.color.b, current.color.b, t)
			}
		}
	}
	return HEIGHT_STOPS[HEIGHT_STOPS.length - 1].color
}

function applyLight(color: Rgb, light: number): Rgb {
	return {
		r: clamp(Math.round(color.r * light), 0, 255),
		g: clamp(Math.round(color.g * light), 0, 255),
		b: clamp(Math.round(color.b * light), 0, 255)
	}
}

function crossesContour(a: number, b: number, interval: number) {
	return Math.floor(a / interval) !== Math.floor(b / interval)
}

function isAtHeightLimit(surface: number, maxY?: number) {
	return maxY !== undefined && Number.isFinite(surface) && surface >= maxY - 1
}

function applyHillshadeStrength(hillshade: number, strength: number) {
	return clamp(1 + ((hillshade - 1) * strength), 0.03, 1.25)
}

function rgbStyle(color: Rgb, light = 1) {
	return `rgb(${clamp(Math.round(color.r * light), 0, 255)}, ${clamp(Math.round(color.g * light), 0, 255)}, ${clamp(Math.round(color.b * light), 0, 255)})`
}

function normalizeMapBiomeColor(color: Rgb): Rgb {
	const average = (color.r + color.g + color.b) / 3
	const maxChannel = Math.max(color.r, color.g, color.b)
	const minChannel = Math.min(color.r, color.g, color.b)
	const saturation = maxChannel - minChannel
	const saturationMix = saturation > 82 ? 0.46 : 0.62
	const target: Rgb = average < 95
		? { r: 96, g: 115, b: 118 }
		: average > 188
		? { r: 178, g: 181, b: 166 }
		: { r: 132, g: 149, b: 118 }

	return {
		r: clamp(Math.round(color.r * saturationMix + target.r * (1 - saturationMix)), 24, 224),
		g: clamp(Math.round(color.g * saturationMix + target.g * (1 - saturationMix)), 36, 224),
		b: clamp(Math.round(color.b * saturationMix + target.b * (1 - saturationMix)), 38, 218)
	}
}

const DIFFERENCE_EPSILON = 0.5

function heightDelta(tuned: TilePoint, baseline: TilePoint) {
	return Number.isFinite(tuned.surface) && Number.isFinite(baseline.surface) ? tuned.surface - baseline.surface : 0
}

function isChanged(tuned: TilePoint, baseline: TilePoint) {
	return Math.abs(heightDelta(tuned, baseline)) > DIFFERENCE_EPSILON
		|| tuned.biome !== baseline.biome
		|| Math.sign(tuned.terrain) !== Math.sign(baseline.terrain)
}

function differenceColor(tuned: TilePoint, baseline: TilePoint): Rgb {
	const surfaceDelta = heightDelta(tuned, baseline)
	const biomeDelta = tuned.biome === baseline.biome ? 0 : 24
	const caveDelta = Math.sign(tuned.terrain) === Math.sign(baseline.terrain) ? 0 : 18
	const magnitude = clamp((Math.abs(surfaceDelta) + biomeDelta + caveDelta) / 96, 0, 1)
	if (magnitude < 0.015) {
		return { r: 34, g: 42, b: 48 }
	}
	const base = Math.abs(surfaceDelta) <= DIFFERENCE_EPSILON
		? { r: 244, g: 202, b: 60 }
		: surfaceDelta > 0
			? { r: 255, g: 42, b: 78 }
			: { r: 26, g: 174, b: 255 }
	const calm = { r: 54, g: 64, b: 72 }
	return {
		r: lerpChannel(calm.r, base.r, magnitude),
		g: lerpChannel(calm.g, base.g, magnitude),
		b: lerpChannel(calm.b, base.b, magnitude)
	}
}

type TilePoint = { surface: number, biome: string, terrain: number }
type TileArray = TilePoint[][]

function maxSurfaceStep(array: TileArray, x: number, z: number) {
	const center = array[x + 1][z + 1].surface
	if (!Number.isFinite(center)) return 0
	return Math.max(
		Math.abs(center - array[x][z + 1].surface),
		Math.abs(center - array[x + 2][z + 1].surface),
		Math.abs(center - array[x + 1][z].surface),
		Math.abs(center - array[x + 1][z + 2].surface)
	)
}

function hasBiomePart(point: TilePoint, parts: string[]) {
	const biome = point.biome.toLowerCase()
	return parts.some(part => biome.includes(part))
}

function passesDifferenceFilter(filter: DifferenceFilterMode, tunedArray: TileArray, baselineArray: TileArray, x: number, z: number) {
	if (filter === "all") return true

	const tuned = tunedArray[x + 1][z + 1]
	const baseline = baselineArray[x + 1][z + 1]
	const highestSurface = Math.max(tuned.surface, baseline.surface)

	switch (filter) {
		case "cliffs":
			return Math.max(maxSurfaceStep(tunedArray, x, z), maxSurfaceStep(baselineArray, x, z)) >= 18
		case "mountains":
			return highestSurface >= 150 || hasBiomePart(tuned, ["mountain", "peak", "slope"]) || hasBiomePart(baseline, ["mountain", "peak", "slope"])
		case "peaks":
			return highestSurface >= 220 || hasBiomePart(tuned, ["peak"]) || hasBiomePart(baseline, ["peak"])
		case "coasts":
			return highestSurface >= 54 && highestSurface <= 82 || hasBiomePart(tuned, ["beach", "shore", "coast"]) || hasBiomePart(baseline, ["beach", "shore", "coast"])
		case "ocean":
			return hasBiomePart(tuned, ["ocean", "river"]) || hasBiomePart(baseline, ["ocean", "river"])
		case "caves":
			return tuned.terrain < 0 || baseline.terrain < 0 || Math.sign(tuned.terrain) !== Math.sign(baseline.terrain)
		case "biomes":
			return tuned.biome !== baseline.biome
	}
}

type Tile = {
	key?: string,
	coords: L.Coords,
	canvas: HTMLCanvasElement,
	ctx: CanvasRenderingContext2D,
	done: L.DoneCallback,
	array?: {
		surface: number,
		biome: string,
		terrain: number
	}[][],
	step?: number,
	sampleMin?: { x: number, y: number },
	sampleMax?: { x: number, y: number },
	isRendering?: boolean,
	workerId: number
}

export class BiomeLayer extends L.GridLayer {
	private next_worker_id = 0

	private Tiles: { [key: string]: Tile } = {}
	private tileSize = 0
	private calcResolution = 0

	private workers: Worker[] = []

	private datapackStore = useDatapackStore()
	private loadedDimensionStore = useLoadedDimensionStore()
	private searchStore = useSearchStore()
	private settingsStore = useSettingsStore()
	private mdfModeStore = useMdfModeStore()

	private datapackLoader: Promise<any> | undefined

	private generationVersion = 0
	private lastTuningRevision = prismTuningDatapack.revision
	private tuningRefreshTimeout: number | undefined
	private tileRenderedListeners = new Set<() => void>()
	private waveImage: Promise<HTMLImageElement>

	constructor(options: L.GridLayerOptions, private do_hillshade: Ref<boolean>, private show_sealevel: Ref<boolean>, private project_down: Ref<boolean>, private y: Ref<number>, private show_heightmap: Ref<boolean>, private surface_biomes: Ref<boolean>, private hillshade_strength: Ref<number>, private cave_view: Ref<CaveViewMode>, private datapackOverride?: AnonymousDatapack, private differenceMode?: Ref<boolean>, private differenceSource?: BiomeLayer, private differenceFilter?: Ref<DifferenceFilterMode>, private clipWarning?: Ref<boolean>) {
		super(options)
		this.tileSize = options.tileSize as number
		this.calcResolution = 1 / 4

		this.createWorkers()
		this.datapackLoader = this.updateWorkers({
			dimension: true,
			registires: true,
			settings: true,
		}),

			this.waveImage = new Promise((resolve) => {
				const waveImage = new Image()
				waveImage.onload = () => resolve(waveImage)
				waveImage.src = "images/wave.png"
			})


		watch([this.searchStore.biomes, () => this.searchStore.disabled], ([biomes, disabled], [oldBiomes, oldDisabled]) => {
			// Do not re-render if no biomes were filtered, regardless of the disabled state
			if (oldDisabled !== disabled && oldBiomes.size === 0 && biomes.size === 0) return
			this.rerender() 
		})

		watch(do_hillshade, () => {
			this.rerender()
		})

		watch(hillshade_strength, () => {
			this.rerender()
		})

		watch(show_sealevel, () => {
			this.rerender()
		})

		watch(show_heightmap, () => {
			this.rerender()
		})

		if (this.differenceMode) {
			watch(this.differenceMode, () => {
				this.rerender()
			})
		}
		if (this.differenceFilter) {
			watch(this.differenceFilter, () => {
				if (this.differenceMode?.value) this.rerender()
			})
		}
		if (this.clipWarning) {
			watch(this.clipWarning, () => {
				if (this.differenceMode?.value) this.rerender()
			})
		}

		watch(cave_view, () => {
			if (this.shouldSkipBaselineTuningUpdate()) return
			this.updateWorkers({
				settings: true
			})
			this.redraw()
		})

		watch(this.project_down, () => {
			if (this.shouldSkipBaselineTuningUpdate()) return
			this.updateWorkers({
				settings: true
			})
			this.redraw()
		})

		watch(this.surface_biomes, () => {
			if (this.shouldSkipBaselineTuningUpdate()) return
			this.updateWorkers({
				settings: true
			})
			this.redraw()
		})

		watch(this.y, () => {
			if (this.shouldSkipBaselineTuningUpdate()) return
			this.updateWorkers({
				settings: true
			})
			this.redraw()
		})

		watch(() => this.mdfModeStore.enabled, async () => {
			await this.updateWorkers({
				settings: true,
				dimension: true,
				registires: true
			})
			this.redraw()
		})

		watch(() => this.settingsStore.seed, () => {
			this.updateWorkers({
				settings: true
			})
			this.redraw()
		})

		if (this.datapackOverride === undefined) {
			this.datapackStore.onTuningChanged(() => {
				if (this.tuningRefreshTimeout !== undefined) {
					window.clearTimeout(this.tuningRefreshTimeout)
				}
				this.tuningRefreshTimeout = window.setTimeout(async () => {
					this.tuningRefreshTimeout = undefined
					await this.updateWorkers({
						settings: true,
						dimension: true,
						registires: true
					})
					this.redraw()
				}, 120)
			})
		}

		if (this.datapackOverride === undefined) {
			this.loadedDimensionStore.$subscribe(async () => {
				await this.updateWorkers({
					settings: true,
					dimension: true,
					registires: true
				})
				this.redraw()
			})
		} else {
			watch(
				() => [this.settingsStore.mc_version, this.settingsStore.dimension.toString(), this.settingsStore.world_preset.toString()],
				() => {
					setTimeout(async () => {
						await this.updateWorkers({
							settings: true,
							dimension: true,
							registires: true
						})
						this.redraw()
					}, 0)
				}
			)
		}

	}

	private shouldSkipBaselineTuningUpdate() {
		if (this.datapackOverride === undefined) return false
		if (this.lastTuningRevision === prismTuningDatapack.revision) return false
		this.lastTuningRevision = prismTuningDatapack.revision
		return true
	}

	// ===== Draw tiles that have generated biomes =====
	async renderTile(tile: Tile) {
		tile.isRendering = false
		if (tile.array === undefined || tile.step === undefined) {
			console.warn("trying to render empty tile")
			return
		}

		tile.ctx.clearRect(0, 0, this.tileSize, this.tileSize)

		const waveImage = await this.waveImage

		const project_down = this.project_down.value
		const do_hillshade = this.do_hillshade.value
		const show_sealevel = this.show_sealevel.value
		const show_heightmap = this.show_heightmap.value
		const hillshade_strength = this.hillshade_strength.value
		const cave_view = this.cave_view.value
		const getBiomeColor = this.loadedDimensionStore.getBiomeColor
		const levelHeight = this.loadedDimensionStore.loaded_dimension.level_height
		const maxY = levelHeight ? levelHeight.minY + levelHeight.height : undefined
		const playableTopY = maxY !== undefined ? maxY - 1 : undefined

		for (let x = 0; x < this.tileSize * this.calcResolution; x++) {
			for (let z = 0; z < this.tileSize * this.calcResolution; z++) {
				const biome = tile.array[x + 1][z + 1].biome

				if (this.searchStore.biomes.size > 0
					&& !this.searchStore.biomes.has(biome)
					&& !this.searchStore.disabled
				) {
					continue
				}

				let hillshade = 1.0
				const y = cave_view !== "off" ? this.y.value : project_down ? Math.min(tile.array[x + 1][z + 1].surface, this.y.value) : this.y.value
				const belowSurface = y < tile.array[x + 1][z + 1].surface
				const sourceArray = tile.key && this.differenceMode?.value ? this.differenceSource?.getTileArray(tile.key) : undefined
				if (do_hillshade && tile.array[x + 1][z + 1].terrain < 0){
					hillshade = applyHillshadeStrength(0.15, hillshade_strength)
				} else if (do_hillshade && project_down && !belowSurface) {

					hillshade = applyHillshadeStrength(calculateHillshade(
						tile.array[x + 2][z + 1].surface - tile.array[x][z + 1].surface,
						tile.array[x + 1][z + 2].surface - tile.array[x + 1][z].surface,
						tile.step
					), hillshade_strength)
				}

				if (this.differenceMode?.value && sourceArray === undefined) {
					tile.ctx.fillStyle = "rgb(28, 36, 42)"
				} else if (sourceArray !== undefined) {
					const filter = this.differenceFilter?.value ?? "all"
					const tuned = sourceArray[x + 1][z + 1]
					const clipped = this.clipWarning?.value && playableTopY !== undefined && tuned.surface > playableTopY
					tile.ctx.fillStyle = clipped
						? "rgb(255, 0, 196)"
						: passesDifferenceFilter(filter, sourceArray, tile.array, x, z)
						? rgbStyle(differenceColor(sourceArray[x + 1][z + 1], tile.array[x + 1][z + 1]))
						: "rgb(28, 36, 42)"
				} else if (cave_view !== "off") {
					const biomeColor = normalizeMapBiomeColor(getBiomeColor(biome))
					const openCave = belowSurface && tile.array[x + 1][z + 1].terrain < 0
					const solidUnderground = belowSurface && !openCave
					if (!belowSurface) {
						tile.ctx.fillStyle = cave_view === "full" ? "rgb(18, 28, 36)" : "rgb(8, 13, 18)"
					} else if (openCave) {
						tile.ctx.fillStyle = rgbStyle(biomeColor, cave_view === "full" ? 1.05 : 0.95)
					} else if (solidUnderground && cave_view === "full") {
						tile.ctx.fillStyle = rgbStyle(biomeColor, 0.26)
					} else {
						tile.ctx.fillStyle = "rgb(21, 23, 27)"
					}
				} else if (show_heightmap) {
					const surface = tile.array[x + 1][z + 1].surface
					const hillshade = applyHillshadeStrength(calculateHillshade(
						tile.array[x + 2][z + 1].surface - tile.array[x][z + 1].surface,
						tile.array[x + 1][z + 2].surface - tile.array[x + 1][z].surface,
						tile.step
					), hillshade_strength)
					const right = tile.array[x + 2][z + 1].surface
					const down = tile.array[x + 1][z + 2].surface
					const contour = crossesContour(surface, right, 16) || crossesContour(surface, down, 16)
					const majorContour = crossesContour(surface, right, 64) || crossesContour(surface, down, 64)
					const color = applyLight(heightColor(surface), (hillshade * 0.35) + 0.82)
					if (isAtHeightLimit(surface, maxY)) {
						tile.ctx.fillStyle = "rgb(198, 55, 84)"
					} else if (majorContour) {
						tile.ctx.fillStyle = "rgb(20, 22, 26)"
					} else if (contour) {
						tile.ctx.fillStyle = "rgba(34, 38, 42, 0.72)"
					} else {
						tile.ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`
					}
				} else {
					let biomeColor = normalizeMapBiomeColor(getBiomeColor(biome))
					tile.ctx.fillStyle = rgbStyle(biomeColor, hillshade)
				}

				tile.ctx.fillRect(x / this.calcResolution, z / this.calcResolution, 1 / this.calcResolution, 1 / this.calcResolution)

				if (show_sealevel && !belowSurface) {
					if (y < this.loadedDimensionStore.noise_generator_settings.seaLevel - 2) {
						tile.ctx.drawImage(waveImage, x / this.calcResolution % 16, z / this.calcResolution % 16, 4, 4, x / this.calcResolution, z / this.calcResolution, 4, 4)
					}
				}

			}
		}

		for (const listener of this.tileRenderedListeners) listener()
	}

	async rerender() {
		console.log("rerendering")
		for (const key in this.Tiles) {
			if (!this.Tiles[key].isRendering) {
				this.Tiles[key].isRendering = true
				setTimeout(() => this.renderTile(this.Tiles[key]), 0)
			}
		}
	}

	getTileArray(key: string) {
		return this.Tiles[key]?.array
	}

	getSurfaceAtBlock(blockX: number, blockZ: number): number | undefined {
		if (!this._map) return undefined
		const quartX = blockX / 4
		const quartZ = blockZ / 4
		const sampleSize = this.tileSize * this.calcResolution

		for (const key in this.Tiles) {
			const tile = this.Tiles[key]
			if (tile.array === undefined || tile.step === undefined || tile.sampleMin === undefined || tile.sampleMax === undefined) continue

			const west = Math.min(tile.sampleMin.x, tile.sampleMax.x)
			const east = Math.max(tile.sampleMin.x, tile.sampleMax.x)
			const north = Math.min(tile.sampleMin.y, tile.sampleMax.y)
			const south = Math.max(tile.sampleMin.y, tile.sampleMax.y)
			if (quartX < west || quartX > east || quartZ < north || quartZ > south) continue

			const ix = clamp(Math.round((quartX - tile.sampleMin.x) / tile.step), 0, sampleSize - 1)
			const iz = clamp(Math.round((quartZ - tile.sampleMin.y) / tile.step), 0, sampleSize - 1)
			return tile.array[ix + 1]?.[iz + 1]?.surface
		}

		return undefined
	}

	getDifferenceStats(filter: DifferenceFilterMode = this.differenceFilter?.value ?? "all"): DifferenceStats {
		let total = 0
		let changed = 0
		let heightChanged = 0
		let maxDelta = 0
		let sumDelta = 0
		let clipCount = 0
		const levelHeight = this.loadedDimensionStore.loaded_dimension.level_height
		const playableTopY = levelHeight ? levelHeight.minY + levelHeight.height - 1 : undefined

		for (const key in this.Tiles) {
			const baselineArray = this.Tiles[key].array
			const tunedArray = this.differenceSource?.getTileArray(key)
			if (baselineArray === undefined || tunedArray === undefined) continue

			for (let x = 0; x < this.tileSize * this.calcResolution; x++) {
				for (let z = 0; z < this.tileSize * this.calcResolution; z++) {
					if (!passesDifferenceFilter(filter, tunedArray, baselineArray, x, z)) continue

					const tuned = tunedArray[x + 1][z + 1]
					const baseline = baselineArray[x + 1][z + 1]
					total++
					if (isChanged(tuned, baseline)) changed++
					const delta = Math.abs(heightDelta(tuned, baseline))
					if (delta > DIFFERENCE_EPSILON) {
						heightChanged++
						sumDelta += delta
						maxDelta = Math.max(maxDelta, delta)
					}
					if (playableTopY !== undefined && tuned.surface > playableTopY) {
						clipCount++
					}
				}
			}
		}

		return {
			total,
			changed,
			changedPercent: total > 0 ? changed / total * 100 : 0,
			maxDelta,
			averageDelta: heightChanged > 0 ? sumDelta / heightChanged : 0,
			clipCount
		}
	}

	onTilesRendered(listener: () => void) {
		this.tileRenderedListeners.add(listener)
		return () => this.tileRenderedListeners.delete(listener)
	}


	// ==== Manage workers to generate biomes of tiles
	private createWorkers() {
		this.workers = []
		for (let i = 0; i < WORKER_COUNT; i++) {
			const worker = new MultiNoiseCalculator()
			worker.onmessage = (ev) => {
				if (ev.data.generationVersion < this.generationVersion) {
					return
				}
				const tile = this.Tiles[ev.data.key]
				if (tile === undefined)
					return

				tile.array = ev.data.array
				tile.step = ev.data.step

				tile.isRendering = true
				this.renderTile(tile)

				tile.done()
				tile.done = () => { /* nothing */ }
			}

			this.workers.push(worker)
		}
	}

	async updateWorkers(do_update: {
		registires?: boolean,
		dimension?: boolean,
		settings?: boolean,
	}) {
		this.generationVersion++
		const update: any = {
			generationVersion: this.generationVersion,
			mdfMode: this.mdfModeStore.enabled
		}

		if (do_update.registires) {
			update.densityFunctions = {}
			const datapack = this.datapackOverride ?? this.datapackStore.composite_datapack
			for (const id of await datapack.getIds(ResourceLocation.WORLDGEN_DENSITY_FUNCTION)) {
				update.densityFunctions[id.toString()] = await datapack.get(ResourceLocation.WORLDGEN_DENSITY_FUNCTION, id)
			}

			update.noises = {}
			for (const id of await datapack.getIds(ResourceLocation.WORLDGEN_NOISE)) {
				update.noises[id.toString()] = await datapack.get(ResourceLocation.WORLDGEN_NOISE, id)
			}
		}

		if (do_update.dimension) {
			update.biomeSourceJson = toRaw(this.loadedDimensionStore.loaded_dimension.biome_source_json)
			update.noiseGeneratorSettingsJson = toRaw(this.loadedDimensionStore.loaded_dimension.noise_settings_json)
			update.surfaceDensityFunctionId = getCustomDensityFunction("snowcapped_surface", this.loadedDimensionStore.loaded_dimension.noise_settings_id!, this.settingsStore.dimension)?.toString() ?? "<none>"
			update.terrainDensityFunctionId = getCustomDensityFunction("map_simple_terrain", this.loadedDimensionStore.loaded_dimension.noise_settings_id!, this.settingsStore.dimension)?.toString() ?? "<none>"
		}

		if (do_update.settings) {
			update.seed = this.settingsStore.seed
			update.y = this.y.value
			update.project_down = this.project_down.value
			update.surface_biomes = this.surface_biomes.value
			update.cave_view = this.cave_view.value
			const levelHeight = this.loadedDimensionStore.loaded_dimension.level_height
			update.levelMaxY = levelHeight ? levelHeight.minY + levelHeight.height : undefined
			update.levelMinY = levelHeight?.minY
		}

		this.workers.forEach(w => w.postMessage({ update }))
	}

	generateTile(key: string, coords: L.Coords, worker_id: number) {
		// @ts-expect-error: _tileCoordsToBounds does not exist
		const tileBounds = this._tileCoordsToBounds(coords);
		const west = tileBounds.getWest(),
			east = tileBounds.getEast(),
			north = tileBounds.getNorth(),
			south = tileBounds.getSouth();

		const crs = this._map.options.crs!,
			min = crs.project(L.latLng(north, west)).multiplyBy(0.25),
			max = crs.project(L.latLng(south, east)).multiplyBy(0.25);

		min.y *= -1
		max.y *= -1

		const task = {
			key,
			min,
			max,
			tileSize: this.tileSize * this.calcResolution
		}

		if (this.Tiles[key] !== undefined) {
			this.Tiles[key].sampleMin = { x: min.x, y: min.y }
			this.Tiles[key].sampleMax = { x: max.x, y: max.y }
		}

		this.workers[worker_id].postMessage({ task })
	}

	createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
		const tile = L.DomUtil.create("canvas", "leaflet-tile")
		tile.width = tile.height = this.tileSize

		tile.onselectstart = tile.onmousemove = L.Util.falseFn

		const ctx = tile.getContext("2d")!

		if (!this._map) {
			return tile;
		}

		this.datapackLoader?.then(() => {
			const key = this._tileCoordsToKey(coords)
			this.Tiles[key] = { key, coords: coords, canvas: tile, ctx: ctx, done: done, workerId: this.next_worker_id }

			this.generateTile(key, coords, this.next_worker_id)
			this.next_worker_id = (this.next_worker_id + 1) % WORKER_COUNT
		})

		return tile
	}

	_removeTile(key: string) {
		if (this.Tiles[key] === undefined)
			return

		this.workers[this.Tiles[key].workerId].postMessage({ cancel: key })

		delete this.Tiles[key]

		// @ts-expect-error: _removeTile does not exist
		L.TileLayer.prototype._removeTile.call(this, key)
	}

}
