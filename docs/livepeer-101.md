# Livepeer 101

Livepeer is a decentralized compute network for video and real-time AI workloads.

In this starter app, Livepeer Agent is treated as the media execution layer:

- Director creates a focused prompt.
- Livepeer Agent runs the media job.
- The app stores only safe output references and metadata in DKG.

The mock adapter simulates Livepeer output references so the app can be run without credentials. Real Livepeer integration is behind explicit environment configuration.
