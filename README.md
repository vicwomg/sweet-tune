# SweetTune

A portrait-first, touch-friendly strobe and temperament tuner built for **multi-instrumentalists** who need to switch between and program custom temperaments, sweetened tunings, and instrument-specific offsets with minimal friction.

## Features

- **One-Tap Preset Switching**: Pin up to 10 temperaments in the quick bar right above the tuner; tap the active preset again to edit it.
- **Custom Temperament Editor**: Adjust per-note cent offsets (`-50` to `+50`), toggle sharp/flat spelling (`#`/`♭`) per temperament, set key-dependent transposition, and include/exclude individual notes or strings.
- **Built-in Temperaments & Instrument Presets**:
  - Historical & standard: **Equal**, **Just Intonation**, **Pythagorean**, **1/4 Meantone**, **Werckmeister III**, **Kirnberger III**, **Vallotti**
  - Guitar: **Guitar** (standard EADGBE equal), **JT Acoustic** (James Taylor sweetened tuning)
  - Lap Steel (John Ely): **Ely C13th**, **Ely A6th**, **Ely E13th**, **Ely B11th**
- **Four Live Tuner Views**:
  - **Wheel**: Concentric circular strobe rings
  - **Bands**: Horizontal scrolling strobe bands
  - **Dial**: Coarse (`-25` to `+25`) and fine (`-5` to `+5`) needle gauges
  - **LED**: Coarse (`-25` to `+25`) and fine (`-5` to `+5`) segmented light bars
- **Practical Stage Tools**: Tap-to-lock **Note Lock** with semitone steppers, adjustable `A4` calibration (`415–466 Hz`), mic noise gate, and a built-in reference tone generator.

## Tech Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Audio DSP**: Web Audio API (`AudioWorklet` using McLeod Pitch Method + Schmitt-trigger noise gate)
- **Mobile Ready**: Configured with `capacitor.config.ts` for future iOS/Android packaging

## Getting Started

```bash
npm install
npm run dev
```

### Scripts

- `npm run dev` — Start the Vite dev server
- `npm test` — Run unit tests (`vitest`)
- `npm run build` — Type-check and build production bundle into `dist/`
- `npm run preview` — Preview the production build locally

## Deploying to Render.com

This repository includes a [`render.yaml`](./render.yaml) Blueprint for a Render Static Site (with automatic HTTPS for microphone access):

1. Push this repository to GitHub or GitLab.
2. In Render, select **New + → Blueprint** (or **New + → Static Site** with build command `npm ci && npm run build` and publish directory `dist`).

## License

[MIT](./LICENSE)
