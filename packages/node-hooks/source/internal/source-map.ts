import { Buffer } from 'node:buffer';
import { SourceMap, type SourceMapPayload } from 'node:module';

/** A source map as the hooks write it, with the fields that Node reads */
export interface SourceMapJson {
    version: number;
    sources: ReadonlyArray<string | null | undefined>;
    mappings: string;
    names?: readonly string[];
    sourceRoot?: string;
    sourcesContent?: ReadonlyArray<string | null | undefined>;
}

/** A source that may end with an inline source map, split from it */
export interface SplitSource {
    code: string;
    map: SourceMapPayload | undefined;
}

/** A mapping of a position in the generated code, zero-based */
interface Segment {
    line: number;
    column: number;
    originalLine: number;
    originalColumn: number;
}

const SOURCE_MAPPING_URL = '//# sourceMappingURL=';
const inlineSourceMapPattern =
    /^\/\/# sourceMappingURL=data:application\/json(?:;charset=utf-8)?;base64,([\d+/=A-Za-z]+)\s*$/u;

const BASE64 =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const COMMA = 0x2c;
const SEMICOLON = 0x3b;

/**
 * Splits a source map off the end of a source, where a hook before this one
 * appended it as a base64 data URL. Node reads only a module's last source
 * map, so one elsewhere stays in the code. A map that doesn't parse is
 * dropped, as Node would ignore it.
 */
export function splitInlineSourceMap(source: string): SplitSource {
    const index = source.lastIndexOf(SOURCE_MAPPING_URL);
    if (index === -1) {
        return { code: source, map: undefined };
    }

    const match = inlineSourceMapPattern.exec(source.slice(index));
    if (match === null) {
        return { code: source, map: undefined };
    }

    const code = source.slice(0, index);
    try {
        const json = Buffer.from(match[1], 'base64').toString('utf8');
        return { code, map: JSON.parse(json) as SourceMapPayload };
    } catch {
        return { code, map: undefined };
    }
}

/**
 * Maps each position that `map` maps, from the code that it generated, on
 * to the original sources of `input`, which mapped the code that `map` was
 * generated from. A position maps through the closest mapping of `input`
 * before it on the same line; one on a line that `input` doesn't map is
 * left out.
 */
export function remapSourceMap(
    map: SourceMapJson,
    input: SourceMapPayload
): SourceMapJson {
    const inputMap = new SourceMap(input);
    const sources: string[] = [];
    const sourceIndices = new Map<string, number>();
    const encoder = new MappingsEncoder();

    for (const segment of decodeMappings(map.mappings)) {
        const entry = inputMap.findEntry(
            segment.originalLine,
            segment.originalColumn
        );
        if (
            !('originalSource' in entry) ||
            entry.generatedLine !== segment.originalLine
        ) {
            continue;
        }

        let sourceIndex = sourceIndices.get(entry.originalSource);
        if (sourceIndex === undefined) {
            sourceIndex = sources.push(entry.originalSource) - 1;
            sourceIndices.set(entry.originalSource, sourceIndex);
        }

        encoder.add(
            segment.line,
            segment.column,
            sourceIndex,
            entry.originalLine,
            entry.originalColumn
        );
    }

    // Node's lookups give the sources without the root, as `input` names them
    const sourceRoot =
        typeof input.sourceRoot === 'string' && input.sourceRoot !== ''
            ? { sourceRoot: input.sourceRoot }
            : {};

    return {
        version: 3,
        ...sourceRoot,
        sources,
        names: [],
        mappings: encoder.toString()
    };
}

/** Appends a source map to the code, as a base64 data URL */
export function appendSourceMap(code: string, map: SourceMapJson): string {
    const encoded = Buffer.from(JSON.stringify(map)).toString('base64');

    return `${code}\n${SOURCE_MAPPING_URL}data:application/json;base64,${encoded}\n`;
}

/**
 * The segments of the mappings that map to a source, from oxc, whose
 * mappings are valid
 */
function* decodeMappings(mappings: string): Generator<Segment> {
    const fields: number[] = [];
    let line = 0;
    let column = 0;
    let originalLine = 0;
    let originalColumn = 0;
    let value = 0;
    let shift = 0;

    for (let index = 0; index <= mappings.length; index++) {
        // A last semicolon ends the last segment
        const char = mappings.codePointAt(index) ?? SEMICOLON;

        if (char === COMMA || char === SEMICOLON) {
            if (fields.length > 0) {
                column += fields[0];
            }
            if (fields.length >= 4) {
                originalLine += fields[2];
                originalColumn += fields[3];
                yield { line, column, originalLine, originalColumn };
            }
            fields.length = 0;

            if (char === SEMICOLON) {
                line++;
                column = 0;
            }
            continue;
        }

        // Each digit holds five bits of the value, and whether more follow
        const digit = base64Value(char);
        value += (digit & 31) << shift;
        if ((digit & 32) === 0) {
            fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
            value = 0;
            shift = 0;
        } else {
            shift += 5;
        }
    }
}

/** The value of a base64 digit, from its code */
function base64Value(code: number): number {
    if (code >= 0x61) {
        // a-z
        return code - 0x61 + 26;
    }
    if (code >= 0x41) {
        // A-Z
        return code - 0x41;
    }
    if (code >= 0x30) {
        // 0-9
        return code - 0x30 + 52;
    }

    return code === 0x2b ? 62 : 63;
}

/** Writes the mappings of a source map, segment by segment, in order */
class MappingsEncoder {
    #mappings = '';
    #line = 0;
    #lineHasSegments = false;
    #column = 0;
    #sourceIndex = 0;
    #originalLine = 0;
    #originalColumn = 0;

    add(
        line: number,
        column: number,
        sourceIndex: number,
        originalLine: number,
        originalColumn: number
    ): void {
        if (line > this.#line) {
            this.#mappings += ';'.repeat(line - this.#line);
            this.#line = line;
            this.#lineHasSegments = false;
            this.#column = 0;
        }
        if (this.#lineHasSegments) {
            this.#mappings += ',';
        }

        this.#mappings +=
            encodeValue(column - this.#column) +
            encodeValue(sourceIndex - this.#sourceIndex) +
            encodeValue(originalLine - this.#originalLine) +
            encodeValue(originalColumn - this.#originalColumn);

        this.#lineHasSegments = true;
        this.#column = column;
        this.#sourceIndex = sourceIndex;
        this.#originalLine = originalLine;
        this.#originalColumn = originalColumn;
    }

    toString(): string {
        return this.#mappings;
    }
}

/** Encodes a value as base64 VLQ, with its sign in the lowest bit */
function encodeValue(value: number): string {
    let rest = value < 0 ? (-value << 1) | 1 : value << 1;
    let encoded = '';

    do {
        let digit = rest & 31;
        rest >>>= 5;
        if (rest > 0) {
            digit |= 32;
        }
        encoded += BASE64[digit];
    } while (rest > 0);

    return encoded;
}
