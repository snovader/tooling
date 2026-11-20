import { Buffer } from 'node:buffer';

/** A source map as the hooks write it, with the fields that Node reads */
export interface SourceMapJson {
    version: number;
    sources: ReadonlyArray<string | null | undefined>;
    mappings: string;
    names?: readonly string[];
    sourceRoot?: string;
    sourcesContent?: ReadonlyArray<string | null | undefined>;
}

/** The fields of a map of one module that remapping reads */
interface ModuleSourceMap {
    sources: ReadonlyArray<string | null>;
    mappings: string;
    sourceRoot?: string;
}

/** A map of a part of a module, from where the part starts */
interface Section {
    offset: { line: number; column: number };
    map: ModuleSourceMap;
}

/** A map of a module in sections, each of which maps a part of it */
interface IndexSourceMap {
    sections: readonly Section[];
}

/** A source map that a hook before this one wrote */
export type InputSourceMap = IndexSourceMap | ModuleSourceMap;

/** A source that may end with an inline source map, split from it */
export interface SplitSource {
    code: string;
    map: InputSourceMap | undefined;
}

/**
 * The segments of each line of a map that map to a source, each as four
 * numbers: its column, the index of its source, and the line and column in
 * the source, all zero-based. A line without such segments is empty, so
 * that the array has no holes, which V8 reads more slowly.
 */
type Lines = number[][];

/** Where each segment of a map is, and the sources that it maps to */
interface MapIndex {
    lines: Lines;
    sources: ReadonlyArray<string | null>;
}

/**
 * What decoded positions are moved by: the column of the first line, where
 * a section of an index map starts, and the index of the first source
 */
interface DecodeOffset {
    column: number;
    source: number;
}

const SOURCE_MAPPING_URL = '//# sourceMappingURL=';
/** The starts of a source map's base64 data URL, as tools write it */
const DATA_URLS = [
    'data:application/json;base64,',
    'data:application/json;charset=utf-8;base64,'
];

const BASE64 =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const COMMA = 0x2c;
const SEMICOLON = 0x3b;

const NO_OFFSET: DecodeOffset = { column: 0, source: 0 };

/**
 * Splits a source map off the end of a source, where a hook before this one
 * appended it as a base64 data URL. Node reads only a module's last source
 * map, so one elsewhere stays in the code. A map that doesn't parse, or
 * isn't a source map, is dropped, as Node would ignore it.
 */
export function splitInlineSourceMap(source: string): SplitSource {
    const end = trimmedEnd(source);
    // Most modules end in `}` or `;`, which can't end the map's base64, and
    // need no search of their code
    if (end === 0 || !isBase64Digit(source.codePointAt(end - 1) ?? 0)) {
        return { code: source, map: undefined };
    }

    const index = lastIndexOf(source, SOURCE_MAPPING_URL);
    if (index === -1) {
        return { code: source, map: undefined };
    }

    const data = dataUrlData(source, index + SOURCE_MAPPING_URL.length, end);
    if (data === undefined) {
        return { code: source, map: undefined };
    }

    const code = source.slice(0, index);
    try {
        const json = Buffer.from(data, 'base64').toString('utf8');
        const map: unknown = JSON.parse(json);
        return { code, map: isInputSourceMap(map) ? map : undefined };
    } catch {
        return { code, map: undefined };
    }
}

/**
 * Maps each position that `map` maps, from the code that it generated, on
 * to the original sources of `input`, which mapped the code that `map` was
 * generated from. A position maps through the closest mapping of `input`
 * before it on the same line; one on a line that `input` doesn't map is
 * left out. The sources keep the names that `input` gives them, with its
 * `sourceRoot`; an index map's sections keep their names without theirs.
 */
export function remapSourceMap(
    map: SourceMapJson,
    input: InputSourceMap
): SourceMapJson {
    const generated = decodeMappings(map.mappings, NO_OFFSET);
    const original = indexSourceMap(input);
    const writer = new MappingsWriter(original.sources);

    for (const [line, segments] of generated.entries()) {
        for (let index = 0; index < segments.length; index += 4) {
            const originalLine = original.lines[segments[index + 2]];
            if (originalLine === undefined) {
                continue;
            }

            const found = findSegment(originalLine, segments[index + 3]);
            if (found !== -1) {
                writer.add(line, segments[index], originalLine, found);
            }
        }
    }

    const sourceRoot =
        'sourceRoot' in input &&
        typeof input.sourceRoot === 'string' &&
        input.sourceRoot !== ''
            ? { sourceRoot: input.sourceRoot }
            : {};

    return {
        version: 3,
        ...sourceRoot,
        sources: writer.sources(),
        names: [],
        mappings: writer.mappings()
    };
}

/** Appends a source map to the code, as a base64 data URL */
export function appendSourceMap(code: string, map: SourceMapJson): string {
    const encoded = Buffer.from(JSON.stringify(map)).toString('base64');

    return `${code}\n${SOURCE_MAPPING_URL}data:application/json;base64,${encoded}\n`;
}

/** Where the whitespace at the end of the source starts */
function trimmedEnd(source: string): number {
    let end = source.length;
    while (end > 0 && isWhitespace(source.codePointAt(end - 1) ?? 0)) {
        end--;
    }

    return end;
}

function isWhitespace(code: number): boolean {
    // Tab, line feed, carriage return, space
    return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;
}

/** Whether the code is that of a digit of base64, or its padding */
function isBase64Digit(code: number): boolean {
    return (
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        code === 0x2b ||
        code === 0x2f ||
        code === 0x3d
    );
}

/**
 * The index of the last occurrence of the search string, which this finds
 * by searching forwards from each occurrence: V8 searches forwards several
 * times as fast as backwards, through a map's base64 as well
 */
function lastIndexOf(source: string, search: string): number {
    let index = source.indexOf(search);
    if (index === -1) {
        return -1;
    }

    let next = source.indexOf(search, index + 1);
    while (next !== -1) {
        index = next;
        next = source.indexOf(search, index + 1);
    }

    return index;
}

/**
 * The data of a base64 data URL of JSON from the start up to the end, if
 * the URL is one, and on the source's last line
 */
function dataUrlData(
    source: string,
    start: number,
    end: number
): string | undefined {
    const prefix = DATA_URLS.find(url => source.startsWith(url, start));
    if (prefix === undefined) {
        return undefined;
    }

    const dataStart = start + prefix.length;
    const lineEnd = source.indexOf('\n', dataStart);
    if (lineEnd !== -1 && lineEnd < end) {
        return undefined;
    }

    return source.slice(dataStart, end);
}

function isInputSourceMap(value: unknown): value is InputSourceMap {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    if ('sections' in value) {
        return Array.isArray(value.sections) && value.sections.every(isSection);
    }

    return isModuleSourceMap(value);
}

function isSection(value: unknown): value is Section {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const { offset, map } = value as Partial<Record<keyof Section, unknown>>;
    return (
        typeof offset === 'object' &&
        offset !== null &&
        Number.isInteger((offset as { line?: unknown }).line) &&
        Number.isInteger((offset as { column?: unknown }).column) &&
        isModuleSourceMap(map)
    );
}

function isModuleSourceMap(value: unknown): value is ModuleSourceMap {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const { sources, mappings } = value as Partial<
        Record<keyof ModuleSourceMap, unknown>
    >;
    return typeof mappings === 'string' && Array.isArray(sources);
}

/**
 * Decodes the segments of an input map by line, with those of each section
 * of an index map moved to where the section starts
 */
function indexSourceMap(map: InputSourceMap): MapIndex {
    if (!('sections' in map)) {
        return {
            lines: decodeMappings(map.mappings, NO_OFFSET),
            sources: map.sources
        };
    }

    const lines: Lines = [];
    const sources: Array<string | null> = [];
    for (const { offset, map: sectionMap } of map.sections) {
        const decoded = decodeMappings(sectionMap.mappings, {
            column: offset.column,
            source: sources.length
        });
        sources.push(...sectionMap.sources);
        addSection(lines, decoded, offset.line);
    }

    return { lines, sources };
}

/**
 * Adds the lines of a section from the line where it starts, where the
 * section before it may end
 */
function addSection(lines: Lines, section: Lines, start: number): void {
    while (lines.length < start) {
        lines.push([]);
    }

    for (const [index, segments] of section.entries()) {
        const line = lines[start + index];
        if (line === undefined) {
            lines.push(segments);
        } else {
            line.push(...segments);
        }
    }
}

/**
 * Decodes the segments of mappings that map to a source, by line, moved by
 * the offset. Invalid mappings decode to positions that map nowhere useful,
 * rather than throwing, as Node's own decoding does.
 */
function decodeMappings(mappings: string, offset: DecodeOffset): Lines {
    const { length } = mappings;
    const lines: Lines = [];
    const fields = [0, 0, 0, 0, 0];
    let segments: number[] = [];
    let fieldCount = 0;
    let column = offset.column;
    let source = offset.source;
    let originalLine = 0;
    let originalColumn = 0;
    let value = 0;
    let shift = 0;

    for (let index = 0; index <= length; index++) {
        // A semicolon past the end ends the last line. Reading a character
        // there instead took a third of the time of remapping a small map,
        // as did codePointAt, though the mappings are base64.
        // oxlint-disable-next-line unicorn/prefer-code-point -- As above
        const char = index < length ? mappings.charCodeAt(index) : SEMICOLON;

        if (char === COMMA || char === SEMICOLON) {
            if (fieldCount > 0) {
                column += fields[0];
            }
            if (fieldCount >= 4) {
                source += fields[1];
                originalLine += fields[2];
                originalColumn += fields[3];
                segments.push(column, source, originalLine, originalColumn);
            }
            fieldCount = 0;

            if (char === SEMICOLON) {
                lines.push(segments);
                segments = [];
                column = 0;
            }
            continue;
        }

        // Each digit holds five bits of the value, and whether more follow
        const digit = base64Value(char);
        value += (digit & 31) << shift;
        if ((digit & 32) === 0) {
            fields[fieldCount++] = value & 1 ? -(value >>> 1) : value >>> 1;
            value = 0;
            shift = 0;
        } else {
            shift += 5;
        }
    }

    return lines;
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

/**
 * The offset in a line's segments of the last segment at or before the
 * column, or -1, by a binary search of the segments, which are in order
 */
function findSegment(segments: readonly number[], column: number): number {
    let low = 0;
    let high = segments.length / 4 - 1;
    let found = -1;

    while (low <= high) {
        const middle = (low + high) >>> 1;
        if (segments[middle * 4] <= column) {
            found = middle * 4;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    return found;
}

/**
 * Writes the mappings of a remapped source map, segment by segment in order,
 * and the sources that they map to, in the order that they first appear
 */
class MappingsWriter {
    readonly #inputSources: ReadonlyArray<string | null>;
    /** The index of each input source among the sources, or -1 */
    readonly #sourceIndices: Int32Array;
    readonly #sources: Array<string | null> = [];
    readonly #lines: string[] = [];
    #lineMappings = '';
    #column = 0;
    #source = 0;
    #originalLine = 0;
    #originalColumn = 0;

    constructor(inputSources: ReadonlyArray<string | null>) {
        this.#inputSources = inputSources;
        this.#sourceIndices = new Int32Array(inputSources.length).fill(-1);
    }

    /** Maps the column of the line to the segment of the input map */
    add(
        line: number,
        column: number,
        segments: readonly number[],
        offset: number
    ): void {
        this.#moveToLine(line);

        const source = this.#sourceIndex(segments[offset + 1]);
        const originalLine = segments[offset + 2];
        const originalColumn = segments[offset + 3];

        if (this.#lineMappings !== '') {
            this.#lineMappings += ',';
        }
        this.#lineMappings +=
            encodeValue(column - this.#column) +
            encodeValue(source - this.#source) +
            encodeValue(originalLine - this.#originalLine) +
            encodeValue(originalColumn - this.#originalColumn);

        this.#column = column;
        this.#source = source;
        this.#originalLine = originalLine;
        this.#originalColumn = originalColumn;
    }

    sources(): Array<string | null> {
        return this.#sources;
    }

    mappings(): string {
        return [...this.#lines, this.#lineMappings].join(';');
    }

    /** Ends the lines before this one, whose columns start again from 0 */
    #moveToLine(line: number): void {
        while (this.#lines.length < line) {
            this.#lines.push(this.#lineMappings);
            this.#lineMappings = '';
            this.#column = 0;
        }
    }

    #sourceIndex(inputSource: number): number {
        let index = this.#sourceIndices[inputSource];
        if (index === -1) {
            index = this.#sources.push(this.#inputSources[inputSource]) - 1;
            this.#sourceIndices[inputSource] = index;
        }

        return index;
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
