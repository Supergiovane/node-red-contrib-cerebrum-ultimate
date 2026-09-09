/* Shared contract for the Function editor and prompt-based authoring. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CerebrumFunctionApi = factory();
})(typeof window === 'object' ? window : this, function () {
    'use strict';
    var methods = {
        '': [
            ['available', 'boolean', 'Whether the selected Cerebrum node is deployed and available.'],
            ['info', 'info()', 'Identity of the selected Cerebrum node.'],
            ['knx', 'KNX catalog', 'Selected group addresses and their observed states.'],
            ['states', 'Observed states', 'States from Cerebrum integrations.'],
            ['functions', 'Saved functions', 'Read the managed JavaScript automations in Cerebrum.']
        ],
        knx: [
            ['list', 'list(): GroupAddress[]', 'List all authorized group addresses with observed states.'],
            ['get', 'get(address): GroupAddress | null', 'Find an exact group address. Includes name, DPT and observed state.'],
            ['find', 'find(query): GroupAddress[]', 'Search addresses, names, rooms and aliases.'],
            ['state', 'state(address): ObservedState | null', 'Latest observed state; does not send a KNX read telegram.']
        ],
        states: [
            ['list', 'list(): ObservedState[]', 'List observed states from the selected Cerebrum integrations.'],
            ['get', 'get(key): ObservedState | null', 'Read an observed state by its exact key, for example knx:1/2/3.']
        ],
        functions: [
            ['list', 'list(): SavedFunction[]', 'List saved JavaScript automations, descriptions and status.'],
            ['get', 'get(name): SavedFunction & { code: string } | null', 'Read a saved automation and its JavaScript source. Does not execute it.']
        ]
    };
    var contract = [
        'The read-only cerebrum global is available in On Message, On Start and On Stop. All methods are synchronous and return independent data copies. Check cerebrum.available before use; methods throw if the selected Cerebrum is unavailable.',
        'cerebrum.info() returns {id,name,llmEnabled}. cerebrum.knx.list() and cerebrum.knx.find(query) return group address arrays. cerebrum.knx.get(address) returns {address,name,dpt,readOnly,area,kind,aliases,state} or null. Only addresses authorized in the selected Cerebrum are exposed.',
        'cerebrum.knx.state(address) and cerebrum.states.get(key) return an observed state or null; cerebrum.states.list() lists states. States have key,source,objectId,label,area,kind,value,previousValue,observedAt,verifiedAt,changedAt,refreshIntervalSeconds,fresh,ageMs. Values may be strings or other JSON values. Missing state is null; false and 0 are valid values. fresh is based on evidence timestamps and refresh interval, not a guarantee of the current physical state. No method sends telegrams or refreshes devices.',
        'cerebrum.functions.list() lists managed JavaScript automations with name,status,description,revision,lastRunAt,error. cerebrum.functions.get(name) also returns code, or null when absent. These are data inspection methods, not callable automation functions. No cerebrum write, run, execute, send or device-control methods exist.'
    ].join('\n');
    var union = function (values) {
        // JSON strings keep catalog labels/IDs out of declaration syntax and comments.
        return Array.from(new Set(values.filter(Boolean))).map(function (v) { return JSON.stringify(String(v)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'); }).join(' | ') || 'never';
    };
    var declarations = function (catalog) {
        catalog = catalog || {};
        return [
            'declare namespace CerebrumFunction {',
            'type GroupAddressId = ' + union((catalog.groupAddresses || []).map(function (x) { return x.address; })) + ';',
            'type StateKey = ' + union((catalog.states || []).map(function (x) { return x.key; })) + ';',
            'type FunctionName = ' + union((catalog.functions || []).map(function (x) { return x.name; })) + ';',
            'interface ObservedState { key: string; source: string; objectId: string; label: string | null; area: string | null; kind: string | null; value: unknown; previousValue: unknown; observedAt: string | null; verifiedAt: string | null; changedAt: string | null; refreshIntervalSeconds: number | null; /** Timestamp-based evidence freshness; no device refresh is performed. */ fresh: boolean; ageMs: number | null; }',
            'interface GroupAddress { address: string; name: string; dpt: string; readOnly: boolean; area: string; kind: string; aliases: string[]; state: ObservedState | null; }',
            'interface SavedFunction { name: string; status: string | null; description: string | null; revision: string | null; lastRunAt: string | null; error: string | null; }',
            'interface API {',
            '/** False when the selected Cerebrum is unavailable. Data methods then throw. */ readonly available: boolean;',
            '/** Identity of the selected Cerebrum node. */ info(): { id: string; name: string; llmEnabled: boolean };',
            '/** Authorized group addresses and their observed states. */ readonly knx: {',
            '/** List all authorized addresses with observed states. */ list(): GroupAddress[];',
            '/** Find an exact address with name, DPT, access and observed state. Returns null when missing or not authorized. */ get(address: GroupAddressId | (string & {})): GroupAddress | null;',
            '/** Search by address, name, room or alias. */ find(query: string): GroupAddress[];',
            '/** Latest observed state or null; never sends a KNX telegram. */ state(address: GroupAddressId | (string & {})): ObservedState | null; };',
            '/** Observed states from Cerebrum integrations. */ readonly states: { list(): ObservedState[]; /** Read an exact state key, or null when missing. */ get(key: StateKey | (string & {})): ObservedState | null; };',
            '/** Managed JavaScript automations. Reading never executes them. */ readonly functions: { /** Names, descriptions and status of saved automations. */ list(): SavedFunction[]; /** Read an automation and its code, without running it. */ get(name: FunctionName | (string & {})): (SavedFunction & { code: string }) | null; };',
            '}',
            '}',
            'declare const cerebrum: CerebrumFunction.API;'
        ].join('\n');
    };
    // Both Monaco and Ace use the same catalog-aware completion matching.
    var completions = function (before, catalog) {
        catalog = catalog || {};
        var call = before.match(/\bcerebrum\s*\.\s*(knx|states|functions)\s*\.\s*(get|state)\s*\(\s*(["'])([^"'\r\n]*)$/);
        if (call) {
            if (call[1] !== 'knx' && call[2] !== 'get') return null;
            var items = call[1] === 'knx' ? (catalog.groupAddresses || []).map(function (x) {
                return { value: x.address, label: x.name, detail: [x.dpt && 'DPT ' + x.dpt, x.area, x.readOnly && 'read-only'].filter(Boolean).join(' · ') };
            }) : call[1] === 'states' ? (catalog.states || []).map(function (x) {
                return { value: x.key, label: x.label, detail: x.source };
            }) : (catalog.functions || []).map(function (x) {
                return { value: x.name, label: x.description, detail: x.status };
            });
            return { prefix: call[4], quoted: true, items: items.map(function (x) {
                var escaped = JSON.stringify(x.value).slice(1, -1);
                if (call[3] === "'") escaped = escaped.replace(/'/g, "\\'");
                return { label: x.value + (x.label ? ' — ' + x.label : ''), insertText: escaped, filterText: [x.value, x.label, x.detail].filter(Boolean).join(' '), detail: x.detail || '', documentation: x.label || '', kind: 'value' };
            }) };
        }
        var member = before.match(/\bcerebrum\s*\.\s*(?:(knx|states|functions)\s*\.\s*)?([\w]*)$/);
        if (!member) return null;
        return { prefix: member[2], items: methods[member[1] || ''].map(function (x) {
            return { label: x[0], insertText: x[0], detail: x[1], documentation: x[2], kind: x[1].includes('(') ? 'method' : 'property' };
        }) };
    };
    return { contract: contract, declarations: declarations, completions: completions };
});
