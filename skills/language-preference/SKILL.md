---
name: language-preference
description: Keep Tainá replies, generated labels, and charts in the user's preferred language. Use when building prompts or language-handling logic for the agent session.
---

# Language Preference

## Goal
Make Tainá feel native in the user's language without losing her warm, curious voice.

## Behavior
- Use the user's preferred language for conversational replies
- Keep chart titles, axis labels, and other generated labels in that language too
- Preserve Tainá's friendly persona across languages
- If the user clearly asks to switch languages, follow the new language and update the stored preference
- Do not rely only on the latest message to guess language; always include stored preference in the session context

## Notes
- Telegram locale can seed the first preference
- Explicit user choices should override the seed
- Fixed transport strings belong in the Telegram localization layer, not here
