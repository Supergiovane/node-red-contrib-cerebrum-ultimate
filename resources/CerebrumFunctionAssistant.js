/* global RED, jQuery */
/* Cerebrum authoring UI. Native Function editors own the saved/executed source. */
(function (root) {
    "use strict";

    root.CerebrumFunctionAssistant = {
        create: function (options) {
            var $ = jQuery;
            var node = options.node;
            var closed = false;
            var generationRequest;
            var nodesRequest;
            var proposal;
            var original;
            var sequence = 0;
            var t = function (key) { return node._("cerebrumFunction." + key); };
            var panel = $('<div id="func-tab-cerebrum" class="cerebrum-function-assistant"></div>').hide().appendTo('#func-tabs-content');
            var row = function (label, control) {
                var wrapper = $('<div class="form-row"></div>').appendTo(panel);
                $('<label></label>').attr('for', control.attr('id')).text(label).appendTo(wrapper);
                control.appendTo(wrapper);
                return control;
            };
            var select = $('#node-input-cerebrumNode').empty();
            $('<option value=""></option>').text(t('selectNode')).appendTo(select);
            if (node.cerebrumNode) $('<option></option>').val(node.cerebrumNode).text(node.cerebrumNode).appendTo(select);
            select.val(node.cerebrumNode || '');
            var prompt = row(t('prompt'), $('<textarea id="node-input-aiPrompt" rows="3"></textarea>').val(node.aiPrompt || '').attr('placeholder', t('promptPlaceholder')));
            var example = row(t('example'), $('<textarea id="node-input-aiExample" rows="2"></textarea>').val(node.aiExample || '').attr('placeholder', '{"payload": 23.5}'));
            // Keep the saved boolean enabled, including for previously created nodes.
            $('<input type="checkbox" id="node-input-aiIncludeCatalog">').prop('checked', true).hide().appendTo(panel);
            var controls = $('<div class="form-row"></div>').appendTo(panel);
            var generate = $('<button type="button" class="red-ui-button"></button>').text(t('generate')).appendTo(controls);
            var spinner = $('<i class="fa fa-spinner cerebrum-function-spinner" aria-hidden="true"></i>').hide().prependTo(generate);
            var cancel = $('<button type="button" class="red-ui-button"></button>').text(t('cancel')).hide().appendTo(controls);
            var setGenerating = function (busy) {
                prompt.closest('.form-row').toggle(!busy);
                example.closest('.form-row').toggle(!busy);
                generate.prop('disabled', busy).attr('aria-busy', String(busy));
                spinner.toggleClass('fa-spin', busy).toggle(busy);
                cancel.toggle(busy);
            };
            var status = $('<p class="cerebrum-function-status" role="status" aria-live="polite"></p>').appendTo(panel);
            var preview = $('<div class="cerebrum-function-preview"></div>').hide().appendTo(panel);
            var explanation = $('<p></p>').appendTo(preview);
            var counts = $('<p></p>').appendTo(preview);
            var section = $('<select></select>').attr('aria-label', t('section')).appendTo(preview);
            [['func', 'function'], ['initialize', 'initialize'], ['finalize', 'finalize']].forEach(function (item) {
                $('<option></option>').val(item[0]).text(node._('function.label.' + item[1])).appendTo(section);
            });
            var proposedCode = $('<pre tabindex="0" class="cerebrum-function-proposed-code"></pre>').attr('aria-label', t('proposed')).appendTo(preview);
            var apply = $('<button type="button" class="red-ui-button cerebrum-function-apply"></button>').text(t('apply')).appendTo(preview);
            var discard = $('<button type="button" class="red-ui-button cerebrum-function-discard"></button>').text(t('discard')).appendTo(preview);

            var revealStatus = function () {
                if (panel.is(':visible')) panel.scrollTop(panel.scrollTop() + status.offset().top - panel.offset().top - 6);
            };
            var setStatus = function (message, error) {
                status.text(message).toggleClass('cerebrum-function-error', !!error);
                if (error) revealStatus();
            };
            var render = function () {
                if (!proposal) return;
                proposedCode.text(proposal[section.val()] || t('empty'));
            };
            section.on('change', render);
            var discardProposal = function () {
                proposal = null;
                original = null;
                preview.hide();
            };
            discard.on('click', function () { discardProposal(); setStatus(t('discarded')); });
            var stopRequest = function () {
                sequence++;
                if (generationRequest) generationRequest.abort();
                generationRequest = null;
                setGenerating(false);
            };
            cancel.on('click', function () { stopRequest(); setStatus(t('cancelled')); });
            var notifySelection = function () { if (options.onCerebrumChange) options.onCerebrumChange(select.val()); };
            notifySelection();
            select.on('change.cerebrumFunction', function () { stopRequest(); discardProposal(); setStatus(''); notifySelection(); });

            nodesRequest = $.getJSON('cerebrumUltimate/sidebar/nodes')
                .done(function (data) {
                    if (closed) return;
                    var selected = select.val();
                    var availableNodes = data.nodes || [];
                    select.empty();
                    $('<option value=""></option>').text(t('selectNode')).appendTo(select);
                    availableNodes.forEach(function (item) {
                        $('<option></option>').val(item.id).text((item.name || item.id) + ' — ' + (item.llmEnabled ? (item.llmModel || item.llmProvider) : t('disabled'))).appendTo(select);
                    });
                    if (selected && !select.find('option').toArray().some(function (option) { return option.value === selected; })) {
                        $('<option></option>').val(selected).text(selected + ' — ' + t('unavailable')).appendTo(select);
                    }
                    var firstAvailable = availableNodes.find(function (item) { return item.llmEnabled; }) || availableNodes[0];
                    select.val(selected || (firstAvailable ? firstAvailable.id : ''));
                    notifySelection();
                    if (!availableNodes.length) setStatus(t('noNodes'));
                })
                .fail(function (_, state) { if (!closed && state !== 'abort') setStatus(t('loadError'), true); });

            generate.on('click', function () {
                if (!select.val()) {
                    setStatus(t('noSelection'), true);
                    if (options.showSetup) options.showSetup();
                    select.trigger('focus');
                    return;
                }
                if (!prompt.val().trim()) { setStatus(t('noPrompt'), true); prompt.trigger('focus'); return; }
                if (example.val().trim()) {
                    try {
                        var sample = JSON.parse(example.val());
                        if (!sample || typeof sample !== 'object' || Array.isArray(sample)) throw new Error();
                    } catch (_) { setStatus(t('invalidExample'), true); example.trigger('focus'); return; }
                }
                stopRequest();
                discardProposal();
                var current = options.getCurrent();
                var requestSequence = ++sequence;
                var payload = {
                    cerebrumNode: select.val(),
                    functionNodeId: node.id,
                    prompt: prompt.val(),
                    example: example.val(),
                    includeCatalog: true,
                    language: RED.i18n && RED.i18n.lang ? RED.i18n.lang() : 'en',
                    current: current
                };
                setGenerating(true);
                setStatus('');
                generationRequest = $.ajax({
                    url: 'cerebrumUltimate/function/generate',
                    type: 'POST',
                    contentType: 'application/json',
                    data: JSON.stringify(payload)
                }).done(function (data) {
                    if (closed || requestSequence !== sequence) return;
                    if (!data || !data.ok || !data.proposal) { setStatus(t('invalidResponse'), true); return; }
                    original = current;
                    proposal = data.proposal;
                    var changedSection = ['func', 'initialize', 'finalize'].find(function (key) { return proposal[key] !== original[key]; });
                    section.val(changedSection || 'func');
                    explanation.text(proposal.explanation || '');
                    counts.text(t('outputs') + ': ' + proposal.outputs + '. ' + t('checkWires')).toggle(original.outputs !== proposal.outputs);
                    preview.show();
                    render();
                    setStatus(t('ready'));
                    revealStatus();
                }).fail(function (xhr, state) {
                    if (closed || requestSequence !== sequence || state === 'abort') return;
                    setStatus(xhr.responseJSON && xhr.responseJSON.error || t('generationError'), true);
                }).always(function () {
                    if (closed || requestSequence !== sequence) return;
                    generationRequest = null;
                    setGenerating(false);
                });
            });
            apply.on('click', function () {
                if (!proposal) return;
                if (JSON.stringify(options.getCurrent()) !== JSON.stringify(original)) {
                    setStatus(t('conflict'), true);
                    return;
                }
                options.apply(proposal, section.val());
                discardProposal();
                setStatus('');
            });
            return {
                dispose: function () {
                    closed = true;
                    stopRequest();
                    if (nodesRequest) nodesRequest.abort();
                    select.off('.cerebrumFunction');
                    panel.off();
                }
            };
        }
    };
})(window);
