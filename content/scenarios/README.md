# Scenarios

One JSON file per scenario. The server loads every `*.json` file in this folder at start and validates it strictly. These are data, not code: never hardcode scenario content in TypeScript.

The format is defined in `spec/scenario-schema.md`. The scenario list and rubric focus per scenario are in `content/tracks.md`. Scoring rules are in `spec/scoring.md`.

## Adding a scenario

1. Copy a similar file, for example `self-introduction.json`, and name it `<id>.json`. The `id` is kebab-case and must match the filename.
2. Fill in every field. Add a one-sentence `description`; path generation and the library screen both use it.
3. Declare every `{{key}}` you use in `brief` or `generate` under `userInputs`.
4. Keep each `generate` slot to a single spoken line under 40 words with no stage directions. Set `dependsOnPreviousAnswer` to `false` unless the line truly needs the previous answer.
5. Keep the `durationSec` window consistent with the turns: its upper bound must not exceed the sum of `maxSeconds`.
6. Write `criteriaDisplay` by hand, one line per criterion, in the same order as the rubric (objective first, then judged).
7. Add the scenario to `content/tracks.md`. No code changes are needed.

## Rules

- The rubric is fixed: 4 objective criteria (fillers, pace, pauses, length) and 1 judged criterion. It is never generated.
- Copy is plain, second person, sentence case. No exclamation marks, no emojis.
- Scenes describe the situation, never how the user feels.
