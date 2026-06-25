import { DensityFunction } from "deepslate";

type JsonRecord = Record<string, unknown>;

const vanillaFromJson = DensityFunction.fromJson;
const warnedTypes = new Set<string>();

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function typeOf(value: unknown): string | undefined {
    if (!isRecord(value) || typeof value.type !== "string") return undefined;
    return value.type.replace(/^minecraft:/, "");
}

function readNumber(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeFinite(value: number, fallback = 0): number {
    return Number.isFinite(value) ? value : fallback;
}

function javaRemainder(a: number, b: number): number {
    return a - Math.trunc(a / b) * b;
}

function floorModulo(a: number, b: number): number {
    return a - Math.floor(a / b) * b;
}

function ieeeRemainder(a: number, b: number): number {
    return a - Math.round(a / b) * b;
}

function estimateRange(values: DensityFunction[], fallback = 4096) {
    let min = 0;
    let max = 0;
    for (const value of values) {
        min += safeFinite(value.minValue(), -fallback);
        max += safeFinite(value.maxValue(), fallback);
    }
    return { min: Math.min(min, max), max: Math.max(min, max) };
}

abstract class PrismDensityFunction extends DensityFunction {
    mapAll(visitor: DensityFunction.Visitor): DensityFunction {
        return visitor.map(this);
    }
}

class CoordinateFunction extends PrismDensityFunction {
    constructor(private readonly axis: "x" | "y" | "z") {
        super();
    }

    compute(context: DensityFunction.Context): number {
        return context[this.axis];
    }

    minValue(): number {
        return -30_000_000;
    }

    maxValue(): number {
        return 30_000_000;
    }
}

class AxisClampedGradientFunction extends PrismDensityFunction {
    constructor(
        private readonly axis: "x" | "y" | "z",
        private readonly from: number,
        private readonly to: number,
        private readonly fromValue: number,
        private readonly toValue: number
    ) {
        super();
    }

    compute(context: DensityFunction.Context): number {
        if (this.from === this.to) return this.toValue;
        const t = Math.max(0, Math.min(1, (context[this.axis] - this.from) / (this.to - this.from)));
        return this.fromValue + (this.toValue - this.fromValue) * t;
    }

    minValue(): number {
        return Math.min(this.fromValue, this.toValue);
    }

    maxValue(): number {
        return Math.max(this.fromValue, this.toValue);
    }
}

class UnaryFunction extends PrismDensityFunction {
    constructor(
        private readonly type: string,
        private readonly argument: DensityFunction,
        private readonly transform: (value: number) => number
    ) {
        super();
    }

    compute(context: DensityFunction.Context): number {
        return this.transform(this.argument.compute(context));
    }

    mapAll(visitor: DensityFunction.Visitor): DensityFunction {
        return visitor.map(new UnaryFunction(this.type, this.argument.mapAll(visitor), this.transform));
    }

    minValue(): number {
        switch (this.type) {
            case "sin":
            case "cos":
            case "tanh":
            case "signum":
                return -1;
            case "acos":
            case "sqrt":
            case "log2":
            case "log2_floor":
            case "ln":
                return 0;
            case "asin":
            case "atan":
                return -Math.PI / 2;
            case "ceil":
            case "floor":
            case "round":
            case "cbrt":
                return safeFinite(this.argument.minValue(), -4096);
            default:
                return -4096;
        }
    }

    maxValue(): number {
        switch (this.type) {
            case "sin":
            case "cos":
            case "tanh":
            case "signum":
                return 1;
            case "acos":
                return Math.PI;
            case "asin":
            case "atan":
                return Math.PI / 2;
            case "ceil":
            case "floor":
            case "round":
            case "cbrt":
                return safeFinite(this.argument.maxValue(), 4096);
            default:
                return 4096;
        }
    }
}

class BinaryFunction extends PrismDensityFunction {
    constructor(
        private readonly argument1: DensityFunction,
        private readonly argument2: DensityFunction,
        private readonly transform: (a: number, b: number) => number
    ) {
        super();
    }

    compute(context: DensityFunction.Context): number {
        return this.transform(this.argument1.compute(context), this.argument2.compute(context));
    }

    mapAll(visitor: DensityFunction.Visitor): DensityFunction {
        return visitor.map(new BinaryFunction(this.argument1.mapAll(visitor), this.argument2.mapAll(visitor), this.transform));
    }

    minValue(): number {
        return -4096;
    }

    maxValue(): number {
        return 4096;
    }
}

class OrElseFunction extends PrismDensityFunction {
    constructor(private readonly argument: DensityFunction, private readonly fallback: DensityFunction) {
        super();
    }

    compute(context: DensityFunction.Context): number {
        const value = this.argument.compute(context);
        return Number.isFinite(value) ? value : this.fallback.compute(context);
    }

    mapAll(visitor: DensityFunction.Visitor): DensityFunction {
        return visitor.map(new OrElseFunction(this.argument.mapAll(visitor), this.fallback.mapAll(visitor)));
    }

    minValue(): number {
        return Math.min(this.argument.minValue(), this.fallback.minValue());
    }

    maxValue(): number {
        return Math.max(this.argument.maxValue(), this.fallback.maxValue());
    }
}

class ShiftFunction extends PrismDensityFunction {
    constructor(
        private readonly argument: DensityFunction,
        private readonly shiftX: DensityFunction,
        private readonly shiftY: DensityFunction,
        private readonly shiftZ: DensityFunction
    ) {
        super();
    }

    compute(context: DensityFunction.Context): number {
        return this.argument.compute(DensityFunction.context(
            context.x + this.shiftX.compute(context),
            context.y + this.shiftY.compute(context),
            context.z + this.shiftZ.compute(context)
        ));
    }

    mapAll(visitor: DensityFunction.Visitor): DensityFunction {
        return visitor.map(new ShiftFunction(
            this.argument.mapAll(visitor),
            this.shiftX.mapAll(visitor),
            this.shiftY.mapAll(visitor),
            this.shiftZ.mapAll(visitor)
        ));
    }

    minValue(): number {
        return this.argument.minValue();
    }

    maxValue(): number {
        return this.argument.maxValue();
    }
}

class DistanceFunction extends PrismDensityFunction {
    constructor(
        private readonly points1: DensityFunction[],
        private readonly points2: DensityFunction[],
        private readonly metric: JsonRecord
    ) {
        super();
    }

    compute(context: DensityFunction.Context): number {
        const length = Math.max(this.points1.length, this.points2.length);
        const deltas: number[] = [];
        for (let i = 0; i < length; i++) {
            deltas.push(Math.abs((this.points1[i]?.compute(context) ?? 0) - (this.points2[i]?.compute(context) ?? 0)));
        }
        const metricType = typeof this.metric.type === "string" ? this.metric.type : "euclidean";
        switch (metricType) {
            case "chebyshev":
                return Math.max(...deltas, 0);
            case "manhattan":
                return deltas.reduce((sum, value) => sum + value, 0);
            case "minkowski": {
                const p = Math.max(1, readNumber(this.metric.p, 2));
                return Math.pow(deltas.reduce((sum, value) => sum + Math.pow(value, p), 0), 1 / p);
            }
            case "euclidean":
            default:
                return Math.sqrt(deltas.reduce((sum, value) => sum + value * value, 0));
        }
    }

    mapAll(visitor: DensityFunction.Visitor): DensityFunction {
        return visitor.map(new DistanceFunction(
            this.points1.map(point => point.mapAll(visitor)),
            this.points2.map(point => point.mapAll(visitor)),
            this.metric
        ));
    }

    minValue(): number {
        return 0;
    }

    maxValue(): number {
        return Math.max(4096, estimateRange([...this.points1, ...this.points2]).max);
    }
}

class DotProductFunction extends PrismDensityFunction {
    constructor(
        private readonly points1: DensityFunction[],
        private readonly points2: DensityFunction[]
    ) {
        super();
    }

    compute(context: DensityFunction.Context): number {
        const length = Math.max(this.points1.length, this.points2.length);
        let sum = 0;
        for (let i = 0; i < length; i++) {
            sum += (this.points1[i]?.compute(context) ?? 0) * (this.points2[i]?.compute(context) ?? 0);
        }
        return sum;
    }

    mapAll(visitor: DensityFunction.Visitor): DensityFunction {
        return visitor.map(new DotProductFunction(
            this.points1.map(point => point.mapAll(visitor)),
            this.points2.map(point => point.mapAll(visitor))
        ));
    }

    minValue(): number {
        return -4096;
    }

    maxValue(): number {
        return 4096;
    }
}

class UnsupportedMdfFunction extends PrismDensityFunction {
    constructor(private readonly type: string) {
        super();
        if (!warnedTypes.has(type)) {
            warnedTypes.add(type);
            console.warn(`MDF Mode: ${type} is not implemented yet; using 0 fallback for this function.`);
        }
    }

    compute(): number {
        return 0;
    }

    minValue(): number {
        return 0;
    }

    maxValue(): number {
        return 0;
    }
}

function parsePointList(value: unknown, parse: (value: unknown) => DensityFunction): DensityFunction[] {
    return Array.isArray(value) ? value.map(parse) : [];
}

export function parseDensityFunctionWithMdfMode(obj: unknown, mdfMode: boolean): DensityFunction {
    if (!mdfMode) return vanillaFromJson(obj);
    return parseMdfDensityFunction(obj);
}

export function parseMdfDensityFunction(obj: unknown): DensityFunction {
    if (typeof obj === "string" || typeof obj === "number") {
        return vanillaFromJson(obj, parseMdfDensityFunction);
    }

    const root = isRecord(obj) ? obj : {};
    const type = typeOf(root);
    if (!type?.startsWith("moredfs:")) {
        return vanillaFromJson(obj, parseMdfDensityFunction);
    }

    const id = type.slice("moredfs:".length);
    const argument = () => parseMdfDensityFunction(root.argument);
    const numerator = () => parseMdfDensityFunction(root.numerator);
    const denominator = () => parseMdfDensityFunction(root.denominator);

    switch (id) {
        case "x": return new CoordinateFunction("x");
        case "y": return new CoordinateFunction("y");
        case "z": return new CoordinateFunction("z");
        case "x_clamped_gradient": return new AxisClampedGradientFunction(
            "x",
            readNumber(root.from_x, readNumber(root.from, -30_000_000)),
            readNumber(root.to_x, readNumber(root.to, 30_000_000)),
            readNumber(root.from_value, readNumber(root.from, 0)),
            readNumber(root.to_value, readNumber(root.to, 1))
        );
        case "z_clamped_gradient": return new AxisClampedGradientFunction(
            "z",
            readNumber(root.from_z, readNumber(root.from, -30_000_000)),
            readNumber(root.to_z, readNumber(root.to, 30_000_000)),
            readNumber(root.from_value, readNumber(root.from, 0)),
            readNumber(root.to_value, readNumber(root.to, 1))
        );
        case "polar_coords": return new UnaryFunction(id, new BinaryFunction(new CoordinateFunction("z"), new CoordinateFunction("x"), (z, x) => Math.atan2(z, x)), value => value);
        case "radius": return new DistanceFunction([new CoordinateFunction("x"), new CoordinateFunction("z")], [], { type: "euclidean" });
        case "radius_3d": return new DistanceFunction([new CoordinateFunction("x"), new CoordinateFunction("y"), new CoordinateFunction("z")], [], { type: "euclidean" });
        case "distance": return new DistanceFunction(
            parsePointList(root.points1 ?? root.point1, parseMdfDensityFunction),
            parsePointList(root.points2 ?? root.point2, parseMdfDensityFunction),
            isRecord(root.distance_metric) ? root.distance_metric : { type: "euclidean" }
        );
        case "acos": return new UnaryFunction(id, argument(), Math.acos);
        case "asin": return new UnaryFunction(id, argument(), Math.asin);
        case "atan": return new UnaryFunction(id, argument(), Math.atan);
        case "cosh": return new UnaryFunction(id, argument(), Math.cosh);
        case "sinh": return new UnaryFunction(id, argument(), Math.sinh);
        case "tanh": return new UnaryFunction(id, argument(), Math.tanh);
        case "cos": return new UnaryFunction(id, argument(), Math.cos);
        case "sin": return new UnaryFunction(id, argument(), Math.sin);
        case "tan": return new UnaryFunction(id, argument(), Math.tan);
        case "cbrt": return new UnaryFunction(id, argument(), Math.cbrt);
        case "negate": return new UnaryFunction(id, argument(), value => -value);
        case "sqrt": return new UnaryFunction(id, argument(), Math.sqrt);
        case "ceil": return new UnaryFunction(id, argument(), Math.ceil);
        case "floor": return new UnaryFunction(id, argument(), Math.floor);
        case "round": return new UnaryFunction(id, argument(), Math.round);
        case "sigmoid": return new UnaryFunction(id, argument(), value => 1 / (1 + Math.exp(-value)));
        case "signum": return new UnaryFunction(id, argument(), Math.sign);
        case "log2": return new UnaryFunction(id, argument(), Math.log2);
        case "log2_floor": return new UnaryFunction(id, argument(), value => Math.floor(Math.log2(value)));
        case "ln": return new UnaryFunction(id, argument(), Math.log);
        case "reciprocal": return new UnaryFunction(id, denominator(), value => 1 / value);
        case "div": return new BinaryFunction(numerator(), denominator(), (a, b) => a / b);
        case "floor_div": return new BinaryFunction(numerator(), denominator(), (a, b) => Math.floor(a / b));
        case "mod": return new BinaryFunction(numerator(), denominator(), javaRemainder);
        case "floor_mod": return new BinaryFunction(numerator(), denominator(), floorModulo);
        case "ieee_rem": return new BinaryFunction(numerator(), denominator(), ieeeRemainder);
        case "rem": return new BinaryFunction(numerator(), denominator(), javaRemainder);
        case "subtract": return new BinaryFunction(parseMdfDensityFunction(root.argument1), parseMdfDensityFunction(root.argument2), (a, b) => a - b);
        case "power": return new BinaryFunction(parseMdfDensityFunction(root.base), parseMdfDensityFunction(root.exponent), Math.pow);
        case "log": return new BinaryFunction(argument(), parseMdfDensityFunction(root.base), (value, base) => Math.log(value) / Math.log(base));
        case "clamp": return new DensityFunction.Clamp(argument(), readNumber(root.min, 0), readNumber(root.max, 1));
        case "or_else": return new OrElseFunction(argument(), parseMdfDensityFunction(root.fallback));
        case "resolver":
        case "profiler":
            return argument();
        case "shift": return new ShiftFunction(
            argument(),
            parseMdfDensityFunction(root.shift_x ?? 0),
            parseMdfDensityFunction(root.shift_y ?? 0),
            parseMdfDensityFunction(root.shift_z ?? 0)
        );
        case "dot_product": {
            const a = parsePointList(root.points1 ?? root.point1, parseMdfDensityFunction);
            const b = parsePointList(root.points2 ?? root.point2, parseMdfDensityFunction);
            return new DotProductFunction(a, b);
        }
        case "derivative":
        case "gradient_magnitude":
        case "value_noise":
        case "voronoi_cells":
        case "single_channel_image_tessellation":
        case "gapped_grid_square_spiral":
            return new UnsupportedMdfFunction(type);
        default:
            return new UnsupportedMdfFunction(type);
    }
}

export function withMdfDensityFunctionParser<T>(mdfMode: boolean, fn: () => T): T {
    if (!mdfMode) return fn();
    const original = DensityFunction.fromJson;
    (DensityFunction as typeof DensityFunction & { fromJson: typeof parseMdfDensityFunction }).fromJson = parseMdfDensityFunction;
    try {
        return fn();
    } finally {
        (DensityFunction as typeof DensityFunction & { fromJson: typeof original }).fromJson = original;
    }
}
