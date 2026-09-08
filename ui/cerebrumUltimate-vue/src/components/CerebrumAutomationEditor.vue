<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';

const props = defineProps({
  nodeId: { type: String, required: true },
  request: { type: Function, required: true },
  translate: { type: Function, required: true },
  drafts: { type: Object, required: true },
});
// Keep buffers in App so switching a section or selected node does not lose edits.
const state = reactive(props.drafts[props.nodeId] || {
  files: [], selected: null, content: '', baseline: '', name: '', directory: '',
  compilation: {}, maxBytes: 128 * 1024, busy: false, error: '', message: '', syntaxError: '',
});
props.drafts[props.nodeId] = state;
const confirmDelete = ref(false);
let refreshTimer;
const editor = ref(null);
const lineNumbers = ref(null);
const dirty = computed(() => state.content !== state.baseline);
const bytes = computed(() => new Blob([state.content]).size);
const validName = computed(() => /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.js$/.test(state.name));
const lines = computed(() => Array.from({ length: state.content.split('\n').length }, (_, index) => index + 1).join('\n'));
const tail = () => `automations?nodeId=${encodeURIComponent(props.nodeId)}`;
const apply = file => {
  confirmDelete.value = false;
  state.selected = file;
  state.name = file.name;
  state.content = file.content;
  state.baseline = file.content;
  state.syntaxError = file.syntaxError || '';
  state.maxBytes = file.maxBytes || state.maxBytes;
};
async function refresh(silent = false) {
  if (!props.nodeId || state.busy || (!silent && dirty.value)) return;
  if (!silent) { state.busy = true; state.error = ''; state.message = ''; }
  try {
    const data = await props.request(tail());
    state.compilation = data.compilation || {};
    state.files = data.files || [];
    state.directory = data.directory;
    state.maxBytes = data.maxBytes;
    if (dirty.value) {
      const metadata = state.files.find(file => file.name === state.selected?.name);
      if (metadata) state.selected = { ...state.selected, status: metadata.status, error: metadata.error, lastRunAt: metadata.lastRunAt };
      return;
    }
    const choice = state.files.find(file => file.name === state.selected?.name) || state.files[0];
    if (choice) {
      if (!silent || state.selected?.name !== choice.name || state.selected?.revision !== choice.revision) {
        const selectedName = state.selected?.name;
        const file = await props.request(`${tail()}&name=${encodeURIComponent(choice.name)}`);
        if (!dirty.value && state.selected?.name === selectedName) apply(file);
      }
      else state.selected = { ...state.selected, ...choice };
    }
    else { state.selected = null; state.content = ''; state.baseline = ''; }
  } catch (error) {
    state.error = error.status === 404
      ? props.translate('Restart Node-RED to load the JavaScript editor endpoints, then refresh this page.')
      : error.message;
  } finally { state.busy = false; }
}
async function open(file) {
  if (state.busy || dirty.value) return;
  state.busy = true;
  state.error = '';
  state.message = '';
  try { apply(await props.request(`${tail()}&name=${encodeURIComponent(file.name)}&origin=${file.origin}`)); }
  catch (error) { state.error = error.message; }
  finally { state.busy = false; }
}
async function compileEducation() {
  if (state.busy) return;
  state.busy = true;
  state.error = '';
  try {
    state.compilation = await props.request('automations/compile', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: props.nodeId }),
    });
  } catch (error) { state.error = error.message; }
  finally { state.busy = false; }
}
async function manage(operation) {
  if (state.busy || !state.selected) return;
  state.busy = true;
  state.error = '';
  state.message = '';
  try {
    const data = await props.request('automations/manage', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: props.nodeId, name: state.name, revision: state.selected.revision, operation }),
    });
    confirmDelete.value = false;
    if (operation === 'delete') {
      state.files = state.files.filter(file => file.name !== state.name);
      state.selected = null; state.content = ''; state.baseline = '';
      state.message = props.translate('Automation deleted.');
    } else {
      state.selected = { ...state.selected, ...data };
      state.files = state.files.map(file => file.name === data.name ? { ...file, ...data, content: undefined } : file);
      state.message = props.translate(operation === 'pause' ? 'Automation paused.' : 'Automation resumed.');
    }
  } catch (error) { state.error = error.message; }
  finally { state.busy = false; }
}
async function save() {
  if (!state.selected || state.busy || !validName.value || bytes.value > state.maxBytes) return;
  state.busy = true;
  state.error = '';
  state.message = '';
  try {
    const data = await props.request('automations/save', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nodeId: props.nodeId, name: state.name, origin: state.selected.origin, revision: state.selected.revision, content: state.content }),
    });
    apply(data);
    state.files = [{ ...data, content: undefined }, ...state.files.filter(file => file.name !== data.name)].sort((a, b) => a.name.localeCompare(b.name));
    state.message = props.translate(data.status === 'active' ? 'Changes saved. Automation is running.' : 'Changes saved. Automation remains paused.');
  } catch (error) {
    // Preserve the buffer on syntax, permissions, storage and revision errors.
    state.error = error.message;
  } finally { state.busy = false; }
}
function discard() {
  if (state.busy) return;
  state.content = state.baseline;
  state.error = '';
  state.message = '';
  if (!state.selected) refresh();
}
function download() {
  const url = URL.createObjectURL(new Blob([state.content], { type: 'text/javascript;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = validName.value ? state.name : 'automation.js';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function indent(event) {
  if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  const input = event.target;
  const start = input.selectionStart;
  input.setRangeText('  ', start, input.selectionEnd, 'end');
  state.content = input.value;
}
function syncScroll() { if (lineNumbers.value && editor.value) lineNumbers.value.scrollTop = editor.value.scrollTop; }
onMounted(() => { if (!dirty.value) refresh(); refreshTimer = setInterval(() => refresh(true), 5000); });
onUnmounted(() => clearInterval(refreshTimer));
const statusText = status => props.translate({ active: 'Automation active', paused: 'Paused', error: 'Stopped after an error' }[status] || 'Paused');
</script>

<template>
  <section class="automation-editor" data-cerebrum-localized>
    <div class="automation-heading">
      <h3>{{ translate('JavaScript automations') }}</h3>
    </div>
    <template v-if="nodeId">
      <div class="automation-toolbar">
        <button class="secondary-button" type="button" :disabled="state.busy || dirty" @click="refresh()">{{ translate(state.busy ? 'Loading...' : 'Refresh') }}</button>
        <button class="secondary-button" type="button" :disabled="state.busy || state.compilation?.status === 'generating'" @click="compileEducation">{{ translate('Check AI Education') }}</button>
        <span v-if="dirty" class="unsaved-note">{{ translate('Save or discard your edits before opening another file.') }}</span>
      </div>
      <p v-if="state.error" class="automation-error" role="alert">{{ translate(state.error) }}</p>
      <p v-if="state.message" class="automation-success" role="status">{{ state.message }}</p>
      <div class="automation-layout">
        <nav class="source-list" :aria-label="translate('JavaScript files')">
          <button v-for="file in state.files" :key="file.name" type="button" :class="{ selected: state.selected?.name === file.name }" :aria-current="state.selected?.name === file.name ? 'true' : undefined" :disabled="state.busy || dirty" @click="open(file)">
            <strong>{{ file.description || file.name }}</strong><span>{{ file.name }}</span><span :class="`status-${file.status}`">{{ statusText(file.status) }}</span>
          </button>
          <p v-if="!state.files.length && !state.busy">{{ translate('No automations yet. Ask Cerebrum in chat what you would like to automate.') }}</p>
        </nav>
        <div v-if="state.selected" class="source-pane">
          <div class="source-heading">
            <strong>{{ state.name }}</strong>
            <span class="draft-badge" :class="`status-${state.selected.status}`">{{ statusText(state.selected.status) }}</span>
            <span>{{ bytes.toLocaleString() }} / {{ state.maxBytes.toLocaleString() }} bytes</span>
          </div>
          <p v-if="state.selected.description" class="source-note">{{ state.selected.description }}</p>
          <p v-if="state.selected.lastRunAt" class="source-note">{{ translate('Last run') }}: {{ new Date(state.selected.lastRunAt).toLocaleString() }}</p>
          <p v-if="state.selected.error" class="automation-error" role="alert">{{ translate(state.selected.error) }}</p>
          <div class="automation-toolbar">
            <button v-if="state.selected.status === 'active'" class="secondary-button" type="button" :disabled="state.busy" @click="manage('pause')">{{ translate('Pause') }}</button>
            <button v-else class="primary-button" type="button" :disabled="state.busy || dirty" @click="manage('resume')">{{ translate('Resume') }}</button>
            <button class="secondary-button" type="button" :disabled="state.busy || dirty" @click="confirmDelete = !confirmDelete">{{ translate('Delete automation') }}</button>
          </div>
          <div v-if="confirmDelete" class="delete-confirmation" role="alert">
            <p>{{ translate('Delete this automation? Its function will stop and the .js file will be removed.') }}</p>
            <button class="secondary-button" type="button" :disabled="state.busy" @click="manage('delete')">{{ translate('Confirm deletion') }}</button>
            <button class="secondary-button" type="button" :disabled="state.busy" @click="confirmDelete = false">{{ translate('Cancel') }}</button>
          </div>
          <div class="source-code">
            <pre ref="lineNumbers" class="source-lines" aria-hidden="true">{{ lines }}</pre>
            <textarea ref="editor" v-model="state.content" :aria-label="translate('JavaScript source')" :disabled="state.busy" spellcheck="false" autocorrect="off" autocapitalize="off" autocomplete="off" wrap="off" @input="state.message = ''" @keydown="indent" @scroll="syncScroll"></textarea>
          </div>
          <pre v-if="state.syntaxError && !dirty" class="automation-error">{{ state.syntaxError }}</pre>
          <div class="automation-toolbar">
            <button class="primary-button" type="button" :disabled="state.busy || !validName || bytes > state.maxBytes || !dirty" @click="save">{{ translate('Save changes') }}</button>
            <button class="secondary-button" type="button" :disabled="state.busy" @click="download">{{ translate('Download .js') }}</button>
            <button v-if="dirty" class="secondary-button" type="button" :disabled="state.busy" @click="discard">{{ translate('Discard changes') }}</button>
          </div>
          <p v-if="!validName" class="automation-error">{{ translate('Use a simple filename ending in .js.') }}</p>
          <p v-if="bytes > state.maxBytes" class="automation-error">{{ translate('JavaScript source exceeds 128 KiB') }}</p>
          <p v-if="state.selected.path" class="source-path"><span>{{ translate('Source file') }}</span><code>{{ state.selected.path }}</code></p>
        </div>
      </div>
      <p v-if="state.directory" class="source-path"><span>{{ translate('Automation folder') }}</span><code>{{ state.directory }}</code></p>
    </template>
  </section>
</template>

<style scoped>
.automation-editor { min-width: 0; }
.status-active { color: #5bbf98; }
.status-paused { color: #d4b761; }
.status-error { color: #e47e7e; }
.delete-confirmation { padding: 12px; border: 1px solid #c77373; border-radius: 8px; font-size: 13px; }
.delete-confirmation button { margin-right: 8px; }
.automation-heading, .source-heading, .automation-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.automation-heading { justify-content: space-between; }
.automation-heading h3 { margin: 0 0 8px; }
.source-note, .source-path, .source-list p { color: var(--muted); font-size: 12px; line-height: 1.6; }
.draft-badge { padding: 6px 10px; border: 1px solid var(--line); border-radius: 20px; color: var(--text); font-size: 11px; }
.automation-toolbar { margin: 14px 0; }
.automation-toolbar button { min-height: 36px; }
.automation-layout { display: grid; grid-template-columns: minmax(180px, 235px) minmax(0, 1fr); gap: 20px; margin-top: 20px; }
.source-list { display: flex; flex-direction: column; gap: 8px; }
.source-list button { display: grid; gap: 7px; width: 100%; padding: 14px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel); color: var(--text); text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.source-list button.selected { border-color: var(--accent); background: var(--accent-soft); }
.source-list button:disabled { cursor: default; opacity: .65; }
.source-list button strong { font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; }
.source-list button span, .source-heading > span, .unsaved-note { font-size: 11px; color: var(--muted); }
.source-pane { min-width: 0; }
.source-heading { justify-content: space-between; margin-bottom: 12px; }
.source-heading label { display: grid; gap: 6px; font-size: 12px; }
.source-heading input { min-height: 36px; padding: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--text); border-radius: 6px; }
.source-code { display: flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; background: var(--panel); height: clamp(330px, 52vh, 680px); }
.source-code textarea, .source-lines { font: 12px/1.75 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; tab-size: 2; margin: 0; padding: 16px 12px; box-sizing: border-box; border: 0; border-radius: 0; }
.source-code textarea { flex: 1; width: 100%; min-width: 0; height: 100%; resize: none; background: transparent; color: var(--text); overflow: auto; white-space: pre; }
.source-code textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.source-lines { flex: 0 0 48px; text-align: right; color: var(--muted); border-right: 1px solid var(--line); overflow: hidden; user-select: none; }
.source-path { display: grid; gap: 4px; margin: 16px 0 0; }
.source-path code { font-size: 11px; overflow-wrap: anywhere; }
.automation-error { color: #ed8888; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.automation-success { color: var(--accent); font-size: 12px; }
@media (max-width: 850px) { .automation-layout { grid-template-columns: 1fr; } .source-list { flex-direction: row; flex-wrap: wrap; } .source-list button { width: auto; flex: 1 1 180px; } }
</style>
