/* global jQuery, CerebrumFunctionApi */
(function (root) {
    'use strict';
    root.CerebrumFunctionIntellisense = {
        create: function (options) {
            var catalog = {};
            var selected;
            var request;
            var sequence = 0;
            var closed = false;
            var expanded = false;
            var expandedObserver;
            var expandedAceCleanup;
            var disposables = [];
            var library;
            var monaco = root.monaco;
            var editors = options.editors;
            var hasMonaco = monaco && editors.some(function (editor) { return editor.type === 'monaco'; });
            var defaults = hasMonaco && (monaco.typescript || monaco.languages.typescript).javascriptDefaults;
            var t = function (key) { return options.node._('cerebrumFunction.' + key); };
            var refresh = jQuery('#cerebrum-function-data-refresh');
            var setRefreshHint = function (key) { refresh.attr('title', t(key)).attr('aria-label', t(key)); };
            var updateTypes = function () {
                if (library) library.dispose();
                if (defaults) library = defaults.addExtraLib(CerebrumFunctionApi.declarations(catalog), 'file:///cerebrum-function-' + encodeURIComponent(options.node.id) + '.d.ts');
            };
            if (hasMonaco) {
                disposables.push(monaco.languages.registerCompletionItemProvider('javascript', {
                    triggerCharacters: ['.', '"', "'", '/'],
                    provideCompletionItems: function (model, position) {
                        if (closed || (!expanded && !editors.some(function (editor) { return editor.getModel && editor.getModel() === model; }))) return { suggestions: [] };
                        var before = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
                        var found = CerebrumFunctionApi.completions(before, catalog);
                        // Monaco's TypeScript service supplies typed members/hover.
                        // Add only catalog values here, avoiding duplicate methods.
                        if (!found || !found.quoted) return { suggestions: [] };
                        var range = { startLineNumber: position.lineNumber, startColumn: position.column - found.prefix.length, endLineNumber: position.lineNumber, endColumn: position.column };
                        var kinds = monaco.languages.CompletionItemKind;
                        return { suggestions: found.items.map(function (item) {
                            return Object.assign({}, item, { kind: item.kind === 'method' ? kinds.Method : item.kind === 'value' ? kinds.Value : kinds.Property, range: range, sortText: '0' + item.label });
                        }) };
                    }
                }));
            }
            var attachAce = function (editor) {
                var originalCompleters = editor.completers;
                var originalLive = editor.getOption('enableLiveAutocompletion');
                var completer = {
                    identifierRegexps: [/[a-zA-Z0-9_$\/\-\u00A2-\uFFFF]/],
                    triggerCharacters: ['.', '"', "'"],
                    getCompletions: function (_, session, position, prefix, callback) {
                        var lines = session.getLines(0, position.row);
                        lines[lines.length - 1] = lines[lines.length - 1].slice(0, position.column);
                        var found = CerebrumFunctionApi.completions(lines.join('\n'), catalog);
                        callback(null, found ? found.items.map(function (item) {
                            return { caption: item.label, value: item.insertText, meta: item.detail, score: 1000, docText: item.documentation };
                        }) : []);
                    }
                };
                editor.completers = (originalCompleters || []).concat(completer);
                editor.setOption('enableLiveAutocompletion', true);
                // Older Ace versions ignore completer.triggerCharacters and wait
                // for a word. Explicitly open completion after a dot or quote.
                var afterExec = function (event) {
                    if (closed || event.command.name !== 'insertstring' || !/[."'\/]$/.test(event.args || '')) return;
                    var position = editor.getCursorPosition();
                    var lines = editor.getSession().getLines(0, position.row);
                    lines[lines.length - 1] = lines[lines.length - 1].slice(0, position.column);
                    if (CerebrumFunctionApi.completions(lines.join('\n'), catalog)) editor.execCommand('startAutocomplete');
                };
                editor.commands.on('afterExec', afterExec);
                return { dispose: function () {
                    editor.commands.removeListener('afterExec', afterExec);
                    editor.completers = originalCompleters;
                    editor.setOption('enableLiveAutocompletion', originalLive);
                } };
            };
            editors.filter(function (editor) { return editor.type === 'ace'; }).forEach(function (editor) { disposables.push(attachAce(editor)); });
            var setExpanded = function (value) {
                expanded = value;
                if (expandedObserver) { expandedObserver.disconnect(); expandedObserver = null; }
                if (expandedAceCleanup) { expandedAceCleanup.dispose(); expandedAceCleanup = null; }
                if (value && !hasMonaco && root.ace) {
                    // Native editJavaScript creates its editor asynchronously and
                    // does not expose an on-create hook. Attach once it is rendered.
                    var attachExpanded = function () {
                        var element = root.document.querySelector('#node-input-js .ace_editor');
                        if (!element) return;
                        var editor = root.ace.edit(element);
                        expandedAceCleanup = attachAce(editor);
                        expandedObserver.disconnect();
                    };
                    expandedObserver = new root.MutationObserver(attachExpanded);
                    expandedObserver.observe(root.document.getElementById('red-ui-editor'), { childList: true, subtree: true });
                    attachExpanded();
                }
            };
            updateTypes();
            var setNode = function (id, force) {
                if (closed || (!force && id === selected)) return;
                selected = id;
                var current = ++sequence;
                if (request) request.abort();
                catalog = {};
                updateTypes();
                setRefreshHint(id ? 'dataLoading' : 'dataSelect');
                if (!id) return;
                request = jQuery.getJSON('cerebrumUltimate/function/catalog', { cerebrumNode: id }).done(function (data) {
                    if (closed || current !== sequence) return;
                    catalog = data;
                    updateTypes();
                    setRefreshHint('dataRefresh');
                }).fail(function (_, state) {
                    if (!closed && current === sequence && state !== 'abort') setRefreshHint('dataUnavailable');
                });
            };
            jQuery('#cerebrum-function-data-refresh').on('click.cerebrum', function () { setNode(selected, true); });
            return {
                setNode: setNode,
                setExpanded: setExpanded,
                dispose: function () {
                    closed = true;
                    sequence++;
                    setExpanded(false);
                    if (request) request.abort();
                    if (library) library.dispose();
                    disposables.forEach(function (item) { item.dispose(); });
                    jQuery('#cerebrum-function-data-refresh').off('.cerebrum');
                }
            };
        }
    };
})(window);
