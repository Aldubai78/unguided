#!/usr/bin/env bash
# Unguided Metro — WEB dev loop, detached. Same-machine browser target.
# Watch mode ON (no CI) so code edits hot-reload. 8081 = LLM archivist, never touch.
# S6 fix: this was copied verbatim from the reference scaffold and still cd'd into
# gymforgeapp/app (serving "OpenGym"). Repointed to unguided/app ("Unguided").
cd /home/allen/.openclaw/workspace/projects/unguided/app
exec npx expo start --web --port 8091 --lan
