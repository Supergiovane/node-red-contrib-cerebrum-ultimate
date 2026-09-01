# Cerebrum Ultimate example flows

Import an example from **Node-RED → Menu → Import → Examples → node-red-contrib-cerebrum-ultimate**.

Start with **01 - First Conversation**. Open the Cerebrum node, configure an AI provider, deploy, then click an Inject node.

## Included examples

1. First conversation
2. Onboarding and summary
3. Five general outputs (Home Assistant uses the dedicated sixth output shown in example 8)
4. Independent chat sessions
5. Reminders and monitors
6. Web intelligence
7. Observe ordinary flow events
8. Home Assistant round trip
9. Telegram chat
10. TTS announcements
11. Supervised KNX commands
12. Read-only KNX area diagnosis
13. Daily summary
14. Learning a preference
15. Clear one chat session

## Optional packages

Some examples need an additional package:

- Home Assistant: `node-red-contrib-home-assistant-websocket`
- Telegram: `node-red-contrib-telegrambot`
- TTS: `node-red-contrib-tts-ultimate`
- KNX: `node-red-contrib-knx-ultimate`

Cerebrum itself remains independent from all of them.

## Safety

Examples do not contain API keys, Telegram tokens, KNX gateway addresses or Home Assistant credentials. Add your own configuration before deploying.

The KNX command example keeps command confirmation enabled. Always review the selected ETS group addresses and the resulting command preview before confirming an operation.
