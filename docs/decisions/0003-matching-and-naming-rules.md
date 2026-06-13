# 0003 — Match rule, no-match behavior, substitutions, playlist naming

Date: 2026-06-11 · Status: accepted (product decisions confirmed by project owner)

## Context

The brief (§8) left four product decisions open and explicitly required answers before the decomposition logic is built.

## Decisions

1. **Match-quality rule: exact after normalization.** A track title matches a phrase when they are equal after normalizing both sides: lowercase, strip punctuation and diacritics, and strip version suffixes — parenthetical/bracketed tails ("(Remastered 2011)", "[Live]") and dash tails ("- Radio Edit") — before comparing.
2. **No-match behavior: fail without creating a playlist.** When the backtracking search exhausts all candidate groupings, no playlist is created; the response lists the words/phrases that couldn't be matched so the user can reword and retry.
3. **Substitutions (config-driven map in SentenceEngine, applied when generating candidate variants):**
   - the known four: to→2, you→U, for→4, are→R
   - number words: one→1 … ten→10
   - and→&
   - letter homophones: be→B, see→C, why→Y, oh→O, ex→X
4. **Playlist naming: the sentence itself**, truncated to Spotify's 100-char name limit; branding goes in the playlist description: "Read the track titles in order — made with Say It With a Playlist".

## Consequences

Normalization is a shared pure utility used by both candidate generation (SentenceEngine) and match validation (SpotifyEngine). Every created playlist spells the full sentence — no partial playlists exist (a "preview + user picks replacement" flow remains a post-MVP option).
