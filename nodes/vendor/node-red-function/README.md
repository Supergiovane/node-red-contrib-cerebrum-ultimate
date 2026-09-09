# Node-RED Function upstream source

Cerebrum Function is derived from the Node-RED **5.0.7** release:
https://github.com/node-red/node-red/tree/5.0.7

Copyright JS Foundation and other contributors, http://js.foundation
Licensed under Apache-2.0; the complete license is in [LICENSE](LICENSE).
These derived files retain that license; the rest of Cerebrum retains its existing license.

Copied sources and their original SHA-256 hashes:

- `10-function.js`: `0c39ff826f234e4ceaaf3270d9e827d466bd55618c57ec845a69e2f392fc9bc2`
- `10-function.html`: `897ca624513290ccace3dfc7cb57bc9cd09928803794dad85fee8c23b6fe10e1`
- `messages.json`: `595c6c00b9af4299b11521c8dbdb57371053f801ab0f6c564f9e5044bdd59acb`
- `help.html`: `1f2a752ebd06c6c7cb18c73a2ebb9d363c424be3fb3ab025385c5af4157d54ad`
- `function.svg`: `b5215cf98df7824bb5b889fa2051a42b5bd55c3f944a4638117c861ed30b5ff2`

Source paths are under `packages/node_modules/@node-red/nodes/`:
`core/function/10-function.{js,html}`, `locales/en-US/messages.json` (Function messages only),
`locales/en-US/function/10-function.html` and `icons/function.svg`.
Native Function messages also use the matching `de`, `fr` and `zh-CN` locale catalogs from the same release. Cerebrum authoring labels and help are local additions.

Local modifications: distinct `cerebrum-function` type; reuse native Function settings and library without registering them again; a clear Node-RED version error for `node.linkcall`; an assistant editor tab and its lifecycle hooks; a read-only `cerebrum` runtime facade and editor completion for selected catalog/state/function data; Cerebrum labels/help and translations. AI authoring lives in separate modules and does not participate in message execution.

The runtime regression suite runs on Node-RED 5.0.7 by default. To check another installed Node-RED runtime, set `CEREBRUM_TEST_NODE_RED` to its absolute `lib/red.js` path and run `npx mocha test/cerebrumFunction.test.js`. The compatibility suite has also been verified with Node-RED 3.1.1.
