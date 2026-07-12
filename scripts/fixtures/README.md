# Voice acceptance fixtures

`voice-stage-filter.wav` is a mono, 48 kHz, 16-bit PCM recording of the
artifact-bound acceptance prompt:

> Point to the Stage filter with your visible cursor, then explain what it does.

`voice-approve-draft.wav` uses the same format for a bound confirmation reply:

> Yes, approve that exact draft creation.

The fixture was generated with the macOS `Samantha` English voice. It supplies
only microphone input. The acceptance test still uses the built SDK, live demo,
real Gemini Live session, real backend planner, DOM actor, cursor, verification,
and persisted run evidence for every result it asserts.
