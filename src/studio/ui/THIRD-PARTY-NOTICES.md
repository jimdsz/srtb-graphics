# UI component attributions

`SlideAction.tsx` adapts the open-source Kokonut UI Slide Text Button pattern.
Source: https://github.com/kokonut-labs/kokonutui/blob/main/components/kokonutui/slide-text-button.tsx
Copyright (c) 2025 kokonutUI.
The adaptation uses a native button and local CSS, removes the Next.js/Tailwind dependency and large entrance motion, and keeps identical visible and accessible action labels.

An earlier `ProgressGauge.tsx` adapted the linear notch geometry from Bklit UI's Gauge.
Source: https://github.com/bklit/bklit-ui/blob/main/packages/ui/src/charts/gauge.tsx
Copyright (c) 2026 uixmat.
The current component uses a standard linear fill and supplied measured progress; it no longer includes that SVG notch geometry. The original attribution is retained here. No Bklit Studio code is used.

## MIT License (both adaptations)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Package integrations

- Motion 13.4.1 (`motion/mini` and `motion/react`), MIT. https://github.com/motiondivision/motion
- Thinking Orbs 0.3.2, MIT © Jakub Antalik. https://github.com/Jakubantalik/thinking-orbs

Their complete licenses are supplied in the installed packages and recorded in the npm lockfile.
