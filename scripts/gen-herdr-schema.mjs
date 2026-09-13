#!/usr/bin/env node
/**
 * Generates lib/HerdrSchema.js, the table of herdr API names gjetr is tested
 * against, from the schema fixtures of every supported herdr build.
 *
 * Usage:
 *   node scripts/gen-herdr-schema.mjs                        # regenerate from tests/fixtures/herdr-<version>/
 *   node scripts/gen-herdr-schema.mjs --capture              # record the herdr on PATH as a fixture, then regenerate
 *   node scripts/gen-herdr-schema.mjs --capture --binary /tmp/herdr-0.9.0
 *   node scripts/gen-herdr-schema.mjs --check                # fail if lib/HerdrSchema.js is stale, or the
 *                                                            # installed herdr differs from its own fixture
 *   node scripts/gen-herdr-schema.mjs --check --fixtures-only   # the first half only (node tests)
 *
 * A fixture is tests/fixtures/herdr-<version>/ holding `schema.json`, the
 * verbatim output of `herdr api schema --json`, and `agent-kinds.json`, the
 * `--kind` values `herdr agent start --help` offers (the schema types
 * `pane.agent` as a free string, so the kinds are not in it). Every fixture
 * directory is a supported build.
 *
 * The schema document is `{protocol, schema_version, schemas}` with five
 * self-contained JSON Schema documents (`request`, `success_response`,
 * `error_response`, `event`, `subscription_event`); `$ref`s point at
 * `#/schemas/<document>/$defs/<Name>`.
 *
 * The binary is looked up PATH first, as obsidian-herdr's gen-types.mjs does:
 * a stale copy in a fixed directory must not stand in for the herdr running.
 * Nothing here talks to a herdr server; `api schema` and `--help` are offline.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'lib', 'HerdrSchema.js');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const FIXTURE_DIR = /^herdr-(\d+)\.(\d+)\.(\d+)$/;

const BINARY_CANDIDATES = [join(homedir(), '.local', 'bin', 'herdr'), '/usr/local/bin/herdr', '/usr/bin/herdr'];

// The requests gjetr sends; their params are recorded per build.
const SENT_METHODS = ['events.subscribe', 'pane.focus', 'ping', 'session.snapshot', 'tab.focus', 'workspace.focus'];
// The result variants gjetr reads.
const READ_RESULTS = ['pong', 'session_snapshot', 'subscription_started'];
// success_response objects gjetr reads, by the name the table gives them.
const READ_OBJECTS = {
	snapshot: 'SessionSnapshot',
	agent: 'AgentInfo',
	pane: 'PaneInfo',
	tab: 'TabInfo',
	workspace: 'WorkspaceInfo',
	agentSession: 'AgentSessionInfo',
};

function parseArgs(argv) {
	const args = { binary: '', capture: false, check: false, fixturesOnly: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--check') args.check = true;
		else if (arg === '--capture') args.capture = true;
		else if (arg === '--fixtures-only') args.fixturesOnly = true;
		else if (arg === '--binary') args.binary = argv[++i] ?? '';
		else throw new Error(`unknown argument ${arg}`);
	}
	return args;
}

function resolveBinary(override) {
	if (override) return override;
	try {
		const onPath = execFileSync('sh', ['-lc', 'command -v herdr'], { encoding: 'utf8' }).trim();
		if (onPath && existsSync(onPath)) return onPath;
	} catch {
		// Not on PATH; fall through to the fixed directories.
	}
	return BINARY_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

function run(binary, argv) {
	return execFileSync(binary, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function binaryVersion(binary) {
	const match = /(\d+\.\d+\.\d+)/.exec(run(binary, ['--version']));
	if (!match) throw new Error(`${binary} --version names no version`);
	return match[1];
}

function binaryKinds(binary) {
	const help = run(binary, ['agent', 'start', '--help']);
	const match = /--kind <KIND>[\s\S]*?\[possible values: ([^\]]+)\]/.exec(help);
	if (!match) throw new Error(`${binary} agent start --help lists no --kind values`);
	return match[1].split(',').map((kind) => kind.trim()).filter(Boolean);
}

function kindsDocument(version, kinds) {
	return `${JSON.stringify({ herdr: version, source: 'herdr agent start --help, --kind possible values', kinds }, null, 2)}\n`;
}

function fixtureVersions() {
	if (!existsSync(FIXTURES)) return [];
	return readdirSync(FIXTURES)
		.map((name) => FIXTURE_DIR.exec(name))
		.filter(Boolean)
		.map((match) => ({ version: `${match[1]}.${match[2]}.${match[3]}`, parts: match.slice(1, 4).map(Number) }))
		.sort((a, b) => a.parts[0] - b.parts[0] || a.parts[1] - b.parts[1] || a.parts[2] - b.parts[2])
		.map((entry) => entry.version);
}

function fixturePath(version, file) {
	return join(FIXTURES, `herdr-${version}`, file);
}

function readFixture(version) {
	return {
		schemaText: readFileSync(fixturePath(version, 'schema.json'), 'utf8'),
		kinds: JSON.parse(readFileSync(fixturePath(version, 'agent-kinds.json'), 'utf8')).kinds,
	};
}

// ------------------------------------------------------------------ extraction

const REF = /^#\/schemas\/([a-z_]+)\/\$defs\/([A-Za-z0-9_]+)$/;

function need(value, what) {
	if (value === undefined || value === null) throw new Error(`schema has no ${what}`);
	return value;
}

function resolve(schemas, node) {
	if (!node || typeof node.$ref !== 'string') return node;
	const match = REF.exec(node.$ref);
	if (!match) throw new Error(`unexpected $ref ${node.$ref}`);
	return need(schemas[match[1]]?.$defs?.[match[2]], node.$ref);
}

function keys(node) {
	return Object.keys(node?.properties ?? {}).sort();
}

function tagged(members, tag, what) {
	const out = {};
	for (const member of need(members, what)) {
		const value = member?.properties?.[tag]?.const;
		if (typeof value !== 'string') throw new Error(`${what} has a variant without a ${tag}`);
		out[value] = member;
	}
	return out;
}

function extract(version, schemaText, kinds) {
	const document = JSON.parse(schemaText);
	const { schemas } = document;
	if (typeof document.protocol !== 'number') throw new Error(`herdr ${version}: schema has no protocol`);
	const defs = (name) => need(schemas[name]?.$defs, `${name} $defs`);

	const requests = tagged(need(schemas.request, 'request').oneOf, 'method', 'request');
	const requestParams = {};
	for (const method of SENT_METHODS) {
		const params = resolve(schemas, need(requests[method], `method ${method}`).properties?.params);
		requestParams[method] = { properties: keys(params), required: [...(params?.required ?? [])].sort() };
	}

	const results = tagged(defs('success_response').ResponseResult?.oneOf, 'type', 'ResponseResult');
	const resultFields = {};
	for (const type of READ_RESULTS) resultFields[type] = keys(need(results[type], `result ${type}`));

	const fields = {};
	for (const [name, def] of Object.entries(READ_OBJECTS)) fields[name] = keys(need(defs('success_response')[def], def));

	const events = tagged(defs('event').EventData?.oneOf, 'type', 'EventData');
	const eventFields = {};
	for (const type of Object.keys(events).sort()) eventFields[type] = keys(events[type]);

	return {
		version,
		protocol: document.protocol,
		schemaVersion: document.schema_version,
		eventKinds: [...need(defs('event').EventKind?.enum, 'EventKind')],
		eventFields,
		subscriptionTypes: Object.keys(tagged(defs('request').Subscription?.oneOf, 'type', 'Subscription')),
		methods: Object.keys(requests).sort(),
		requestParams,
		resultFields,
		fields,
		agentStatuses: [...need(defs('success_response').AgentStatus?.enum, 'AgentStatus')],
		integrationTargets: [...need(defs('success_response').IntegrationTarget?.enum, 'IntegrationTarget')],
		agentKinds: [...kinds],
	};
}

// ------------------------------------------------------------------ output

// Objects one key per line, arrays of plain values on one line.
function pretty(value, indent) {
	if (Array.isArray(value) && value.every((item) => item === null || typeof item !== 'object')) {
		return JSON.stringify(value).replace(/","/g, '", "');
	}
	const inner = `${indent}  `;
	if (Array.isArray(value)) {
		return `[\n${value.map((item) => inner + pretty(item, inner)).join(',\n')}\n${indent}]`;
	}
	if (value && typeof value === 'object') {
		const entries = Object.entries(value).map(([key, item]) => `${inner}${JSON.stringify(key)}: ${pretty(item, inner)}`);
		return entries.length === 0 ? '{}' : `{\n${entries.join(',\n')}\n${indent}}`;
	}
	return JSON.stringify(value);
}

function generate(versions) {
	const kinds = [];
	for (const entry of versions) for (const kind of entry.agentKinds) if (!kinds.includes(kind)) kinds.push(kind);
	const supported = versions.map((entry) => ({ version: entry.version, protocol: entry.protocol }));
	return [
		'.pragma library',
		'',
		'// GENERATED by scripts/gen-herdr-schema.mjs from tests/fixtures/herdr-*/. Do not edit;',
		'// run `node scripts/gen-herdr-schema.mjs` after adding or recapturing a fixture.',
		'//',
		'// The herdr API names gjetr is tested against, per supported build: event and',
		'// subscription names, every method, the params of the requests gjetr sends, the',
		'// fields of the results and objects it reads, and the agent kinds herdr reports.',
		'// Unknown fields and names stay tolerated at runtime; this is what each build',
		'// promised, never what a newer one may add.',
		'',
		`var SUPPORTED = ${pretty(supported, '')}`,
		'',
		`var AGENT_KINDS = ${pretty(kinds, '')}`,
		'',
		`var VERSIONS = ${pretty(versions, '')}`,
		'',
		'if (typeof module !== "undefined") {',
		'  module.exports = {',
		'    SUPPORTED: SUPPORTED,',
		'    AGENT_KINDS: AGENT_KINDS,',
		'    VERSIONS: VERSIONS',
		'  }',
		'}',
		'',
	].join('\n');
}

function generateFromFixtures() {
	const versions = fixtureVersions();
	if (versions.length === 0) throw new Error(`no fixtures in ${relative(ROOT, FIXTURES)}`);
	return generate(versions.map((version) => {
		const { schemaText, kinds } = readFixture(version);
		return extract(version, schemaText, kinds);
	}));
}

function sameJson(a, b) {
	return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
}

// ------------------------------------------------------------------ main

const args = parseArgs(process.argv.slice(2));
const out = relative(ROOT, OUT);

if (args.capture) {
	const binary = resolveBinary(args.binary);
	if (!binary) throw new Error('no herdr binary found; pass --binary');
	const version = binaryVersion(binary);
	const schemaText = run(binary, ['api', 'schema', '--json']);
	const kinds = binaryKinds(binary);
	extract(version, schemaText, kinds);
	mkdirSync(join(FIXTURES, `herdr-${version}`), { recursive: true });
	writeFileSync(fixturePath(version, 'schema.json'), schemaText.endsWith('\n') ? schemaText : `${schemaText}\n`);
	writeFileSync(fixturePath(version, 'agent-kinds.json'), kindsDocument(version, kinds));
	process.stdout.write(`captured herdr ${version} from ${binary} into ${relative(ROOT, dirname(fixturePath(version, 'schema.json')))}\n`);
}

const source = generateFromFixtures();

if (args.check) {
	let failed = false;
	const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
	if (current !== source) {
		process.stderr.write(`${out} is stale; run node scripts/gen-herdr-schema.mjs\n`);
		failed = true;
	} else {
		process.stdout.write(`${out} is up to date (herdr ${fixtureVersions().join(', ')})\n`);
	}
	if (!args.fixturesOnly) {
		const binary = resolveBinary(args.binary);
		if (!binary) {
			process.stdout.write('no herdr binary found; installed schema not compared\n');
		} else {
			const version = binaryVersion(binary);
			if (!fixtureVersions().includes(version)) {
				process.stdout.write(`herdr ${version} (${binary}) has no fixture; not compared. Capture it to support it\n`);
			} else {
				const fixture = readFixture(version);
				if (!sameJson(run(binary, ['api', 'schema', '--json']), fixture.schemaText)) {
					process.stderr.write(`herdr ${version} (${binary}) schema differs from its fixture; run --capture\n`);
					failed = true;
				} else if (JSON.stringify(binaryKinds(binary)) !== JSON.stringify(fixture.kinds)) {
					process.stderr.write(`herdr ${version} (${binary}) agent kinds differ from its fixture; run --capture\n`);
					failed = true;
				} else {
					process.stdout.write(`herdr ${version} (${binary}) matches its fixture\n`);
				}
			}
		}
	}
	process.exit(failed ? 1 : 0);
}

writeFileSync(OUT, source);
process.stdout.write(`wrote ${out} (herdr ${fixtureVersions().join(', ')})\n`);
